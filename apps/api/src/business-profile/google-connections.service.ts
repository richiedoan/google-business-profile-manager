import { randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { AppRole } from "@gbp/contracts";
import { PrismaService } from "../database/prisma.service";
import { AppException } from "../errors/app.exception";
import { hashSessionToken } from "../auth/session.service";
import { validateGoogleIdentity } from "../auth/google/google-identity";
import {
  pkceChallenge,
  pkceVerifier,
} from "../auth/google/google-oauth.service";
import type { GoogleConnectionSettings } from "./google-connection-settings";
import { TokenCipher } from "./token-cipher";
import {
  GoogleBusinessProfileProvider,
  GOOGLE_BUSINESS_SCOPE,
} from "./google-business-profile.provider";
import type { UserContext } from "./business-profile.provider";

export class GoogleConnectionsService {
  private readonly cipher?: TokenCipher;
  private readonly tokenCache = new Map<
    string,
    {
      revision: string;
      provider: GoogleBusinessProfileProvider;
      settings: import("./google-business-profile.provider").GoogleProviderSettings;
    }
  >();
  constructor(
    private readonly prisma: PrismaService,
    readonly settings: GoogleConnectionSettings | null,
    private readonly fetcher: typeof fetch = fetch,
    private readonly clientFactory?: (
      settings: GoogleConnectionSettings,
    ) => Pick<OAuth2Client, "generateAuthUrl" | "getToken" | "verifyIdToken">,
  ) {
    if (settings) this.cipher = new TokenCipher(settings.encryptionKey);
  }
  private configured() {
    if (!this.settings || !this.cipher)
      throw new AppException("RESOURCE_NOT_FOUND");
    return this.settings;
  }
  private client() {
    const settings = this.configured();
    if (this.clientFactory) return this.clientFactory(settings);
    return new OAuth2Client({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: settings.redirectUri,
      transporterOptions: { timeout: 10000, retry: false },
    });
  }
  async list(userId: string) {
    if (!this.settings) return { enabled: false, connections: [] };
    const connections = await this.prisma.googleBusinessConnection.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, status: true },
    });
    return { enabled: true, connections };
  }
  async begin(
    userId: string,
    sessionToken: string,
    previousBrowserToken?: string,
  ) {
    const settings = this.configured();
    const state = randomBytes(32).toString("hex");
    const browserToken = randomBytes(32).toString("hex");
    const nonce = randomBytes(32).toString("hex");
    await this.prisma.$transaction(async (tx) => {
      await tx.googleBusinessOAuthTransaction.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            ...(previousBrowserToken
              ? [
                  {
                    browserHash: hashSessionToken(previousBrowserToken),
                    userId,
                  },
                ]
              : []),
          ],
        },
      });
      await tx.googleBusinessOAuthTransaction.create({
        data: {
          stateHash: hashSessionToken(state),
          browserHash: hashSessionToken(browserToken),
          nonceHash: hashSessionToken(nonce),
          sessionHash: hashSessionToken(sessionToken),
          userId,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
    });
    return {
      browserToken,
      url: this.client().generateAuthUrl({
        response_type: "code",
        scope: ["openid", "email", GOOGLE_BUSINESS_SCOPE],
        access_type: "offline",
        prompt: "consent select_account",
        include_granted_scopes: false,
        state,
        nonce,
        code_challenge: pkceChallenge(pkceVerifier(settings, state)),
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    };
  }
  async callback(
    userId: string,
    sessionToken: string,
    query: Record<string, unknown>,
    browserToken?: string,
  ) {
    const settings = this.configured();
    const state = query.state;
    const allowed = new Set([
      "state",
      "code",
      "error",
      "error_description",
      "error_uri",
      "scope",
      "authuser",
      "prompt",
      "hd",
      "iss",
    ]);
    if (
      typeof state !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !browserToken ||
      Object.entries(query).some(
        ([key, value]) =>
          !allowed.has(key) || typeof value !== "string" || value.length > 4096,
      )
    )
      throw new AppException("VALIDATION_FAILED");
    const transaction = await this.prisma.$transaction(async (tx) => {
      const where = {
        stateHash: hashSessionToken(state),
        browserHash: hashSessionToken(browserToken),
        sessionHash: hashSessionToken(sessionToken),
        userId,
        expiresAt: { gt: new Date() },
      };
      const row = await tx.googleBusinessOAuthTransaction.findFirst({ where });
      if (!row) return null;
      return (await tx.googleBusinessOAuthTransaction.deleteMany({ where }))
        .count === 1
        ? row
        : null;
    });
    if (
      !transaction ||
      query.error !== undefined ||
      query.error_description !== undefined ||
      query.error_uri !== undefined ||
      typeof query.code !== "string" ||
      !query.code ||
      (query.iss !== undefined && query.iss !== "https://accounts.google.com")
    )
      throw new AppException("VALIDATION_FAILED");
    const client = this.client();
    let tokens;
    let payload;
    try {
      tokens = (
        await client.getToken({
          code: query.code,
          codeVerifier: pkceVerifier(settings, state),
          redirect_uri: settings.redirectUri,
        })
      ).tokens;
      if (!tokens.id_token) throw new Error("Missing identity");
      payload = (
        await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: settings.clientId,
        })
      ).getPayload();
    } catch {
      throw new AppException("PROVIDER_ERROR");
    }
    const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [];
    const identity = validateGoogleIdentity(
      payload,
      settings.clientId,
      transaction.nonceHash,
      scopes,
    );
    if (!scopes.includes(GOOGLE_BUSINESS_SCOPE))
      throw new AppException("PERMISSION_DENIED");
    const where = {
      userId_googleSubject: { userId, googleSubject: identity.subject },
    };
    const existing = await this.prisma.googleBusinessConnection.findUnique({
      where,
    });
    const encryptedRefreshToken = tokens.refresh_token
      ? this.cipher!.encrypt(
          tokens.refresh_token,
          `${userId}:${identity.subject}`,
        )
      : existing?.status === "ACTIVE"
        ? existing.encryptedRefreshToken
        : undefined;
    if (!encryptedRefreshToken) throw new AppException("UNAUTHENTICATED");
    const data = {
      email: identity.email,
      scopes,
      encryptedRefreshToken,
      status: "ACTIVE",
    };
    const connection = await this.prisma.googleBusinessConnection.upsert({
      where,
      create: { ...data, userId, googleSubject: identity.subject },
      update: data,
    });
    this.tokenCache.delete(connection.id);
  }
  async disconnect(userId: string, id: string) {
    this.configured();
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    )
      throw new AppException("VALIDATION_FAILED");
    const result = await this.prisma.googleBusinessConnection.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw new AppException("RESOURCE_NOT_FOUND");
    this.tokenCache.delete(id);
    return { status: "ok" };
  }
  async resolve(userId: string, role: AppRole, connectionId?: string) {
    const settings = this.configured();
    if (
      connectionId !== undefined &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        connectionId,
      )
    )
      throw new AppException("VALIDATION_FAILED");
    const row = await this.prisma.googleBusinessConnection.findFirst({
      where: {
        userId,
        ...(connectionId ? { id: connectionId } : { status: "ACTIVE" }),
      },
      orderBy: { createdAt: "asc" },
    });
    if (!row) {
      if (connectionId) throw new AppException("PERMISSION_DENIED");
      return null;
    }
    if (row.status !== "ACTIVE") throw new AppException("UNAUTHENTICATED");
    let refreshToken: string;
    try {
      refreshToken = this.cipher!.decrypt(
        row.encryptedRefreshToken,
        `${userId}:${row.googleSubject}`,
      );
    } catch {
      throw new AppException("PROVIDER_ERROR");
    }
    const providerSettings = {
      ...settings,
      refreshToken,
      userId,
      accountIds: [] as string[],
      discoverAccounts: true,
    };
    const revision = row.updatedAt.toISOString();
    let cached = this.tokenCache.get(row.id);
    if (!cached || cached.revision !== revision) {
      cached = {
        revision,
        provider: new GoogleBusinessProfileProvider(
          providerSettings,
          this.fetcher,
        ),
        settings: providerSettings,
      };
      if (this.tokenCache.size >= 1000)
        this.tokenCache.delete(this.tokenCache.keys().next().value!);
      this.tokenCache.set(row.id, cached);
    }
    const provider = cached.provider;
    const context: UserContext = {
      userId,
      role,
      accountIds: cached.settings.accountIds,
    };
    try {
      cached.settings.discoverAccounts = true;
      const accounts = await provider.listAccounts(context);
      cached.settings.accountIds = accounts.map((account) => account.id);
      cached.settings.discoverAccounts = false;
      context.accountIds = cached.settings.accountIds;
      return { provider, context, accounts, connectionId: row.id };
    } catch (error) {
      if (error instanceof AppException && error.code === "UNAUTHENTICATED") {
        await this.prisma.googleBusinessConnection.updateMany({
          where: { id: row.id, userId, updatedAt: row.updatedAt },
          data: { status: "RECONNECT_REQUIRED" },
        });
        this.tokenCache.delete(row.id);
      }
      throw error;
    }
  }
}

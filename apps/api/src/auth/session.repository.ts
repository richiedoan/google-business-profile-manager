import { permissionsForRole } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import type { GoogleIdentity } from "./google/google-identity";
import { Inject, Injectable } from "@nestjs/common";
import type { UserView } from "@gbp/contracts";
import { PrismaService } from "../database/prisma.service";
export interface StoredSession {
  expiresAt: Date;
  user: UserView | null;
}
export interface SessionRepository {
  createLocalSession(
    hash: string,
    expiresAt: Date,
    previousHash?: string,
  ): Promise<UserView>;
  createGoogleSession(
    identity: GoogleIdentity,
    hash: string,
    expiresAt: Date,
    previousHash?: string,
  ): Promise<UserView>;
  find(hash: string): Promise<StoredSession | null>;
  remove(hash: string): Promise<void>;
  updateLanguage(userId: string, language: "en" | "vi"): Promise<void>;
  updateTheme(
    userId: string,
    theme: "light" | "dark" | "system",
  ): Promise<void>;
}
export const SESSION_REPOSITORY = Symbol("SessionRepository");
@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async createLocalSession(
    hash: string,
    expiresAt: Date,
    previousHash?: string,
  ): Promise<UserView> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: "local.viewer@example.test" },
        update: {},
        create: {
          email: "local.viewer@example.test",
          displayName: "Local Viewer",
          membership: { create: { role: "VIEWER" } },
        },
        include: { membership: true },
      });
      if (!user.membership)
        throw new Error("Local fixture membership is missing.");
      if (previousHash)
        await tx.session.deleteMany({ where: { sessionHash: previousHash } });
      await tx.session.create({
        data: { sessionHash: hash, userId: user.id, expiresAt },
      });
      return {
        id: user.id,
        email: user.email,
        themePreference: user.themePreference,
        languagePreference: user.languagePreference,
        displayName: user.displayName,
        role: user.membership.role,
        permissions: permissionsForRole(user.membership.role),
      };
    });
  }
  async createGoogleSession(
    identity: GoogleIdentity,
    hash: string,
    expiresAt: Date,
    previousHash?: string,
  ): Promise<UserView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const connection = await tx.oAuthConnection.findUnique({
          where: {
            provider_providerSubject: {
              provider: "google",
              providerSubject: identity.subject,
            },
          },
        });
        const emailOwner = await tx.user.findFirst({
          where: { email: { equals: identity.email, mode: "insensitive" } },
        });
        // Subject binds identities. Matching email alone never grants access or links accounts.
        if (emailOwner && emailOwner.id !== connection?.userId)
          throw new AppException("PERMISSION_DENIED");
        const user = connection
          ? await tx.user.update({
              where: { id: connection.userId },
              data: {
                email: identity.email,
                displayName: identity.displayName,
              },
              include: { membership: true },
            })
          : await tx.user.create({
              data: {
                email: identity.email,
                displayName: identity.displayName,
                membership: { create: { role: "VIEWER" } },
              },
              include: { membership: true },
            });
        if (!user.membership) throw new AppException("PERMISSION_DENIED");
        await tx.oAuthConnection.upsert({
          where: {
            provider_providerSubject: {
              provider: "google",
              providerSubject: identity.subject,
            },
          },
          create: {
            userId: user.id,
            provider: "google",
            providerSubject: identity.subject,
            scopes: identity.scopes,
          },
          update: { scopes: identity.scopes },
        });
        if (previousHash)
          await tx.session.deleteMany({ where: { sessionHash: previousHash } });
        await tx.session.create({
          data: { sessionHash: hash, userId: user.id, expiresAt },
        });
        return {
          id: user.id,
          email: user.email,
          themePreference: user.themePreference,
          languagePreference: user.languagePreference,
          displayName: user.displayName,
          role: user.membership.role,
          permissions: permissionsForRole(user.membership.role),
        };
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new AppException("PERMISSION_DENIED");
      throw error;
    }
  }
  async find(hash: string): Promise<StoredSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { sessionHash: hash },
      include: { user: { include: { membership: true } } },
    });
    if (!session) return null;
    const user = session.user;
    return {
      expiresAt: session.expiresAt,
      user: user.membership
        ? {
            id: user.id,
            email: user.email,
            themePreference: user.themePreference,
            languagePreference: user.languagePreference,
            displayName: user.displayName,
            role: user.membership.role,
            permissions: permissionsForRole(user.membership.role),
          }
        : null,
    };
  }
  async updateLanguage(userId: string, language: "en" | "vi"): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { languagePreference: language },
    });
  }
  async updateTheme(
    userId: string,
    theme: "light" | "dark" | "system",
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { themePreference: theme },
    });
  }
  async remove(hash: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { sessionHash: hash } });
  }
}

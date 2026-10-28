import { GooglePerformanceProvider } from "./google-performance.provider";
import { GoogleLocationContentClient } from "./google-location-content";
import { ContentCommandSchema } from "@gbp/contracts";
import { z } from "zod";
import {
  googleLocationDetailFieldsSchema,
  mapGoogleDetailFields,
} from "./google-location-detail.mapper";
import type {
  Account,
  LocationDetail,
  LocationQuery,
  LocationSummary,
  PaginatedResult,
  UpdateLocationInput,
} from "@gbp/contracts";
import { hasPermission } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import type {
  BusinessProfileProvider,
  UserContext,
} from "./business-profile.provider";

export const GOOGLE_BUSINESS_SCOPE =
  "https://www.googleapis.com/auth/business.manage";
export interface GoogleProviderSettings {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userId: string;
  accountIds: string[];
  discoverAccounts?: boolean;
}
export { readGoogleConnectionSettings as readGoogleProviderSettings } from "./google-connection-settings";
const accountDto = z.object({
  name: z.string().regex(/^accounts\/[0-9]+$/),
  accountName: z.string(),
});
const locationDto = z
  .object({
    name: z.string().regex(/^locations\/[0-9]+$/),
    title: z.string(),
    storeCode: z.string().optional(),
    storefrontAddress: z
      .object({
        addressLines: z.array(z.string()).optional(),
        sublocality: z.string().optional(),
        locality: z.string().optional(),
        administrativeArea: z.string().optional(),
        postalCode: z.string().optional(),
        regionCode: z.string().optional(),
      })
      .optional(),
    websiteUri: z.string().optional(),
  })
  .extend(googleLocationDetailFieldsSchema.shape);
const listReadMask =
  "name,title,storefrontAddress,openInfo,storeCode,categories.primaryCategory";
const membershipTtl = 5 * 60_000;
const readMask =
  "name,title,storeCode,categories,languageCode,storefrontAddress,serviceArea,latlng,openInfo,websiteUri,phoneNumbers,regularHours,specialHours,moreHours,metadata,profile,labels,serviceItems";
const information = "https://mybusinessbusinessinformation.googleapis.com/v1";
function failure(status: number): AppException {
  return new AppException(
    status === 401
      ? "UNAUTHENTICATED"
      : status === 403
        ? "PERMISSION_DENIED"
        : status === 404
          ? "RESOURCE_NOT_FOUND"
          : status === 429
            ? "PROVIDER_RATE_LIMITED"
            : "PROVIDER_ERROR",
  );
}
/** Tokens stay on the server and are scoped to one stored connection. */
export class GoogleBusinessTokenService {
  private token?: { value: string; expiresAt: number };
  private refreshing?: Promise<string>;
  constructor(
    private readonly settings: GoogleProviderSettings,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  invalidate() {
    this.token = undefined;
  }
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60000)
      return this.token.value;
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async refresh(): Promise<string> {
    try {
      const response = await this.fetcher(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({
            client_id: this.settings.clientId,
            client_secret: this.settings.clientSecret,
            refresh_token: this.settings.refreshToken,
            grant_type: "refresh_token",
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        if (
          z.object({ error: z.literal("invalid_grant") }).safeParse(body)
            .success
        )
          throw new AppException("UNAUTHENTICATED");
        throw failure(response.status);
      }
      const result = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().positive(),
          token_type: z.literal("Bearer"),
          scope: z.string().optional(),
        })
        .safeParse(body);
      if (!result.success) throw new AppException("PROVIDER_ERROR");
      if (
        result.data.scope &&
        !result.data.scope.split(/\s+/).includes(GOOGLE_BUSINESS_SCOPE)
      )
        throw new AppException("PERMISSION_DENIED");
      this.token = {
        value: result.data.access_token,
        expiresAt: Date.now() + result.data.expires_in * 1000,
      };
      return this.token.value;
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException("PROVIDER_ERROR");
    }
  }
}
export class GoogleBusinessProfileProvider implements BusinessProfileProvider {
  private readonly tokens: GoogleBusinessTokenService;
  private accounts?: { rows: Account[]; expiresAt: number };
  private readonly memberships = new Map<
    string,
    { accountId: string; expiresAt: number }
  >();
  private readonly membershipLookups = new Map<string, Promise<string>>();
  constructor(
    private readonly settings: GoogleProviderSettings,
    private readonly fetcher: typeof fetch = fetch,
    tokens?: GoogleBusinessTokenService,
  ) {
    this.tokens = tokens ?? new GoogleBusinessTokenService(settings, fetcher);
  }
  private authorize(context?: UserContext, accountId?: string) {
    if (!context?.userId) throw new AppException("UNAUTHENTICATED");
    if (
      context.userId !== this.settings.userId ||
      !hasPermission(context.role, "location:read") ||
      (accountId &&
        (!context.accountIds.includes(accountId) ||
          !this.settings.accountIds.includes(accountId)))
    )
      throw new AppException("PERMISSION_DENIED");
  }
  private async get<T>(
    url: URL,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await this.fetcher(url, {
          ...init,
          method: init.method ?? "GET",
          redirect: "error",
          signal: AbortSignal.timeout(
            url.pathname.startsWith("/upload/v1/media/") ? 30000 : 10000,
          ),
          headers: {
            ...init.headers,
            Authorization: `Bearer ${await this.tokens.accessToken()}`,
          },
        });
        if (response.status === 401) {
          this.tokens.invalidate();
          if (attempt === 0 && (!init.method || init.method === "GET"))
            continue;
        }
        if (!response.ok) throw failure(response.status);
        const raw = await response.text();
        const result = schema.safeParse(
          url.pathname.startsWith("/upload/v1/media/")
            ? {}
            : raw
              ? JSON.parse(raw)
              : {},
        );
        if (!result.success) throw new AppException("PROVIDER_ERROR");
        return result.data;
      }
      throw new AppException("UNAUTHENTICATED");
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException("PROVIDER_ERROR");
    }
  }
  private async pages<T>(
    url: URL,
    schema: z.ZodType<T>,
    field: "accounts" | "locations",
  ): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const body = await this.get(
        url,
        z.object({
          [field]: z.array(schema).optional(),
          nextPageToken: z.string().optional(),
        }),
      );
      result.push(...((body[field] ?? []) as T[]));
      const next = body.nextPageToken;
      if (!next) return result;
      if (typeof next !== "string" || seen.has(next))
        throw new AppException("PROVIDER_ERROR");
      seen.add(next);
      url.searchParams.set("pageToken", next);
    }
    throw new AppException("PROVIDER_ERROR");
  }
  async listAccounts(context: UserContext): Promise<Account[]> {
    this.authorize(context);
    if (this.accounts && this.accounts.expiresAt > Date.now())
      return this.accounts.rows.filter(
        (row) =>
          this.settings.discoverAccounts ||
          (context.accountIds.includes(row.id) &&
            this.settings.accountIds.includes(row.id)),
      );
    const url = new URL(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    );
    url.searchParams.set("pageSize", "20");
    const rows = (await this.pages(url, accountDto, "accounts"))
      .map((row) => ({ id: row.name.slice(9), name: row.accountName }))
      .filter(
        (row) =>
          this.settings.discoverAccounts ||
          (context.accountIds.includes(row.id) &&
            this.settings.accountIds.includes(row.id)),
      );
    this.accounts = { rows, expiresAt: Date.now() + membershipTtl };
    return rows;
  }
  private map(
    row: z.infer<typeof locationDto>,
    accountId: string,
  ): LocationDetail {
    const address = row.storefrontAddress;
    return {
      id: row.name.slice(10),
      accountId,
      name: row.title,
      storeCode: row.storeCode ?? null,
      primaryCategory:
        row.categories?.primaryCategory?.displayName ??
        row.categories?.primaryCategory?.name ??
        null,
      providerState: "READ",
      editable: false,
      formattedAddress: address
        ? [
            ...(address.addressLines ?? []),
            address.sublocality,
            address.locality,
            address.administrativeArea,
            address.postalCode,
            address.regionCode,
          ]
            .filter(Boolean)
            .join(", ")
        : "",
      status:
        row.openInfo?.status === "CLOSED_TEMPORARILY"
          ? "TEMPORARILY_CLOSED"
          : row.openInfo?.status === "CLOSED_PERMANENTLY"
            ? "PERMANENTLY_CLOSED"
            : "OPEN",
      verificationStatus: "UNKNOWN",
      websiteUrl: row.websiteUri ?? null,
      primaryPhone: row.phoneNumbers?.primaryPhone ?? null,
    };
  }
  async listLocations(
    accountId: string,
    query: LocationQuery,
    context?: UserContext,
  ): Promise<PaginatedResult<LocationSummary>> {
    this.authorize(context, accountId);
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100 ||
      (query.search !== undefined && typeof query.search !== "string") ||
      (query.status !== undefined &&
        !["OPEN", "TEMPORARILY_CLOSED", "PERMANENTLY_CLOSED"].includes(
          query.status,
        ))
    )
      throw new AppException("VALIDATION_FAILED");
    if (
      !/^[0-9]+$/.test(accountId) ||
      (query.pageToken !== undefined &&
        (typeof query.pageToken !== "string" ||
          !query.pageToken ||
          query.pageToken.length > 4096)) ||
      (query.page > 1 && !query.pageToken)
    )
      throw new AppException("VALIDATION_FAILED");
    const url = new URL(`${information}/accounts/${accountId}/locations`);
    url.search = new URLSearchParams({
      readMask: listReadMask,
      pageSize: String(query.pageSize),
      orderBy: "title",
    }).toString();
    if (query.pageToken) url.searchParams.set("pageToken", query.pageToken);
    const filters: string[] = [];
    if (query.search?.trim())
      filters.push(`title:${JSON.stringify(query.search.trim())}`);
    if (query.status) {
      const status =
        query.status === "TEMPORARILY_CLOSED"
          ? "CLOSED_TEMPORARILY"
          : query.status === "PERMANENTLY_CLOSED"
            ? "CLOSED_PERMANENTLY"
            : "OPEN";
      filters.push(`openInfo.status="${status}"`);
    }
    if (filters.length) url.searchParams.set("filter", filters.join(" AND "));
    const body = await this.get(
      url,
      z.object({
        locations: z.array(locationDto).max(query.pageSize).optional(),
        nextPageToken: z.string().max(4096).optional(),
        totalSize: z.number().int().nonnegative().optional(),
      }),
    );
    for (const [id, membership] of this.memberships) {
      if (membership.expiresAt <= Date.now()) this.memberships.delete(id);
    }
    const items = (body.locations ?? []).map((row) => {
      const detail = this.map(row, accountId);
      if (this.memberships.size >= 10_000)
        this.memberships.delete(this.memberships.keys().next().value!);
      this.memberships.set(detail.id, {
        accountId,
        expiresAt: Date.now() + membershipTtl,
      });
      return {
        id: detail.id,
        accountId,
        name: detail.name,
        storeCode: detail.storeCode,
        primaryCategory: detail.primaryCategory,
        providerState: detail.providerState,
        editable: detail.editable,
        formattedAddress: detail.formattedAddress,
        status: detail.status,
      };
    });
    return {
      items,
      total: body.totalSize ?? null,
      page: query.page,
      pageSize: query.pageSize,
      nextPageToken: body.nextPageToken || null,
    };
  }
  /** Recover account scope after a cold start without trusting browser-supplied account IDs. */
  private async resolveMembership(
    id: string,
    title: string,
    context: UserContext,
  ): Promise<string> {
    let pending = this.membershipLookups.get(id);
    if (!pending) {
      pending = this.findAccount(id, title, context).finally(() => {
        this.membershipLookups.delete(id);
      });
      this.membershipLookups.set(id, pending);
    }
    return pending;
  }
  private async findAccount(
    id: string,
    title: string,
    context: UserContext,
  ): Promise<string> {
    for (const accountId of new Set(context.accountIds)) {
      if (!this.settings.accountIds.includes(accountId)) continue;
      this.authorize(context, accountId);
      const url = new URL(`${information}/accounts/${accountId}/locations`);
      url.search = new URLSearchParams({
        readMask: "name",
        pageSize: "100",
        filter: `title=${JSON.stringify(title)}`,
      }).toString();
      const seen = new Set<string>();
      for (let page = 0; page < 1000; page++) {
        const body = await this.get(
          url,
          z.object({
            locations: z
              .array(
                z.object({ name: z.string().regex(/^locations\/[0-9]+$/) }),
              )
              .max(100)
              .optional(),
            nextPageToken: z.string().max(4096).optional(),
          }),
        );
        if (body.locations?.some((row) => row.name === `locations/${id}`)) {
          this.authorize(context, accountId);
          if (this.memberships.size >= 10_000)
            this.memberships.delete(this.memberships.keys().next().value!);
          this.memberships.set(id, {
            accountId,
            expiresAt: Date.now() + membershipTtl,
          });
          return accountId;
        }
        const next = body.nextPageToken;
        if (!next) break;
        if (seen.has(next) || page === 999)
          throw new AppException("PROVIDER_ERROR");
        seen.add(next);
        url.searchParams.set("pageToken", next);
      }
    }
    throw new AppException("RESOURCE_NOT_FOUND");
  }
  async getLocation(id: string, context: UserContext): Promise<LocationDetail> {
    this.authorize(context);
    if (!/^[0-9]+$/.test(id)) throw new AppException("VALIDATION_FAILED");
    let membership = this.memberships.get(id);
    if (membership && membership.expiresAt <= Date.now()) {
      this.memberships.delete(id);
      membership = undefined;
    }
    if (membership) this.authorize(context, membership.accountId);
    else if (
      !context.accountIds.some((accountId) =>
        this.settings.accountIds.includes(accountId),
      )
    )
      throw new AppException("PERMISSION_DENIED");
    const url = new URL(`${information}/locations/${id}`);
    url.searchParams.set("readMask", readMask);
    try {
      const row = await this.get(url, locationDto);
      if (row.name !== `locations/${id}`)
        throw new AppException("PROVIDER_ERROR");
      const accountId =
        membership?.accountId ??
        (await this.resolveMembership(id, row.title, context));
      this.authorize(context, accountId);
      return {
        ...this.map(row, accountId),
        ...mapGoogleDetailFields(row),
      };
    } catch (error) {
      if (
        error instanceof AppException &&
        ["PERMISSION_DENIED", "RESOURCE_NOT_FOUND", "UNAUTHENTICATED"].includes(
          error.code,
        )
      )
        this.memberships.delete(id);
      throw error;
    }
  }
  async getPerformance(
    id: string,
    range: import("@gbp/contracts").PerformanceRange,
    context: UserContext,
  ) {
    await this.getLocation(id, context);
    return new GooglePerformanceProvider((url, schema) =>
      this.get(url, schema),
    ).getPerformance(id, range);
  }
  async getDailyPerformance(
    id: string,
    range: import("@gbp/contracts").PerformanceRange,
    context: UserContext,
  ) {
    await this.getLocation(id, context);
    return new GooglePerformanceProvider((url, schema) =>
      this.get(url, schema),
    ).getPerformance(id, range, false);
  }
  async listContent(
    id: string,
    kind: import("@gbp/contracts").ContentKind,
    pageToken: string | undefined,
    context: UserContext,
  ) {
    const location = await this.getLocation(id, context);
    return new GoogleLocationContentClient((url, schema, init) =>
      this.get(url, schema, init),
    ).list(`accounts/${location.accountId}/locations/${id}`, kind, pageToken);
  }
  async mutateContent(
    id: string,
    command: import("@gbp/contracts").ContentCommand,
    context: UserContext,
  ) {
    this.authorize(context);
    if (!hasPermission(context.role, "location:write"))
      throw new AppException("PERMISSION_DENIED");
    const parsed = ContentCommandSchema.safeParse(command);
    if (!parsed.success) throw new AppException("VALIDATION_FAILED");
    const location = await this.getLocation(id, context);
    return new GoogleLocationContentClient((url, schema, init) =>
      this.get(url, schema, init),
    ).mutate(`accounts/${location.accountId}/locations/${id}`, parsed.data);
  }
  async uploadPhoto(
    id: string,
    file: { buffer: Buffer; mimetype: string },
    category: string,
    context: UserContext,
  ) {
    this.authorize(context);
    if (!hasPermission(context.role, "location:write"))
      throw new AppException("PERMISSION_DENIED");
    const location = await this.getLocation(id, context);
    return new GoogleLocationContentClient((url, schema, init) =>
      this.get(url, schema, init),
    ).upload(
      `accounts/${location.accountId}/locations/${id}`,
      file.buffer,
      file.mimetype,
      category,
    );
  }
  async updateLocation(
    _id: string,
    _input: UpdateLocationInput,
    _context: UserContext,
  ): Promise<LocationDetail> {
    void _id;
    void _input;
    void _context;
    throw new AppException("PERMISSION_DENIED");
  }
}

import {
  AccountPerformanceQuerySchema,
  AccountPerformancePageSchema,
  PerformanceSummarySchema,
  emptyOverviewMetrics,
  overviewMetrics,
  overviewDaily,
  type AccountPerformanceRow,
  type AccountPerformancePage,
} from "@gbp/contracts";
import {
  ContentKindSchema,
  ContentCommandSchema,
  PhotoCategorySchema,
  MAX_PHOTO_BYTES,
} from "@gbp/contracts";
import {
  BulkLocationCommandSchema,
  type BulkLocationResult,
  type UpdateLocationInput,
  PerformanceRangeSchema,
} from "@gbp/contracts";
import { LocationPolicy } from "../auth/location-policy";
import { UpdateLocationInputSchema, type LocationQuery } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import type {
  BusinessProfileProvider,
  UserContext,
} from "./business-profile.provider";
/** Account authorization precedes paginated provider reads. */
export class BusinessProfileService {
  constructor(
    private readonly provider: BusinessProfileProvider,
    private readonly policy = new LocationPolicy(),
    private readonly updatesDisabled = process.env.LOCATION_UPDATES_DISABLED !==
      "false",
  ) {}
  async listAccounts(context: UserContext) {
    this.policy.requirePermission(context, "location:read");
    const effective = this.policy.providerContext(context);
    const accounts = await (
      context.scopedProvider ?? this.provider
    ).listAccounts(effective);
    return accounts.filter((account) =>
      effective.accountIds.includes(account.id),
    );
  }
  async listLocations(
    accountId: string,
    query: LocationQuery,
    context: UserContext,
  ) {
    this.policy.requirePermission(context, "location:read");
    this.policy.requireAccount(context, accountId);
    const accounts = await (
      context.scopedProvider ?? this.provider
    ).listAccounts(this.policy.providerContext(context));
    if (!accounts.some((account) => account.id === accountId))
      throw new AppException("PERMISSION_DENIED");
    return (context.scopedProvider ?? this.provider).listLocations(
      accountId,
      query,
      this.policy.providerContext(context),
    );
  }
  async getLocation(id: string, context: UserContext) {
    this.policy.requirePermission(context, "location:read");
    const detail = await (context.scopedProvider ?? this.provider).getLocation(
      id,
      this.policy.providerContext(context),
    );
    this.policy.requireAccount(context, detail.accountId);
    return detail;
  }
  async getAccountPerformance(
    accountId: string,
    input: unknown,
    context: UserContext,
  ): Promise<AccountPerformancePage> {
    this.policy.requirePermission(context, "location:read");
    this.policy.requireAccount(context, accountId);
    const parsed = AccountPerformanceQuerySchema.safeParse(input);
    if (!parsed.success) throw new AppException("VALIDATION_FAILED");
    const { startDate, endDate, page, pageToken } = parsed.data;
    const range = { startDate, endDate };
    // Small independent batches avoid a long-running request for a large account.
    const listings = await this.listLocations(
      accountId,
      { page, pageSize: 10, ...(pageToken ? { pageToken } : {}) },
      context,
    );
    const provider = context.scopedProvider ?? this.provider;
    const scoped = {
      ...this.policy.providerContext(context),
      accountIds: [accountId],
    };
    const rows: AccountPerformanceRow[] = new Array(listings.items.length);
    let cursor = 0;
    let rateLimited = false;
    const worker = async () => {
      while (cursor < listings.items.length) {
        const index = cursor++;
        const location = listings.items[index];
        try {
          if (rateLimited) throw new AppException("PROVIDER_RATE_LIMITED");
          if (location.accountId !== accountId)
            throw new AppException("PERMISSION_DENIED");
          let summary;
          if (provider.getDailyPerformance)
            summary = await provider.getDailyPerformance(
              location.id,
              range,
              scoped,
            );
          else {
            const detail = await provider.getLocation(location.id, scoped);
            if (detail.accountId !== accountId)
              throw new AppException("PERMISSION_DENIED");
            if (!provider.getPerformance) {
              rows[index] = {
                id: location.id,
                name: location.name,
                status: "EMPTY",
                errorCode: null,
                metrics: emptyOverviewMetrics(),
                daily: [],
              };
              continue;
            }
            summary = await provider.getPerformance(location.id, range, scoped);
          }
          const valid = PerformanceSummarySchema.safeParse(summary);
          if (
            !valid.success ||
            valid.data.startDate !== startDate ||
            valid.data.endDate !== endDate
          )
            throw new AppException("PROVIDER_ERROR");
          const metrics = overviewMetrics(valid.data);
          rows[index] = {
            id: location.id,
            name: location.name,
            status: Object.values(metrics).some((value) => value !== null)
              ? "READY"
              : "EMPTY",
            errorCode: null,
            metrics,
            daily: overviewDaily(valid.data),
          };
        } catch (error) {
          if (
            error instanceof AppException &&
            error.code === "PROVIDER_RATE_LIMITED"
          )
            rateLimited = true;
          rows[index] = {
            id: location.id,
            name: location.name,
            status: "ERROR",
            errorCode:
              error instanceof AppException ? error.code : "PROVIDER_ERROR",
            metrics: emptyOverviewMetrics(),
            daily: [],
          };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, listings.items.length) }, worker),
    );
    let nextPage: AccountPerformancePage["nextPage"] = null;
    if (listings.nextPageToken !== undefined) {
      if (listings.nextPageToken) {
        if (listings.nextPageToken === pageToken)
          throw new AppException("PROVIDER_ERROR");
        nextPage = { page: page + 1, pageToken: listings.nextPageToken };
      }
    } else if (
      listings.items.length > 0 &&
      (listings.total === null || page * 10 < listings.total)
    )
      nextPage = { page: page + 1 };
    return AccountPerformancePageSchema.parse({
      accountId,
      ...range,
      rows,
      totalLocations: listings.total,
      nextPage,
      fetchedAt: new Date().toISOString(),
    });
  }
  async getPerformance(id: string, input: unknown, context: UserContext) {
    const range = PerformanceRangeSchema.safeParse(input);
    if (!range.success) throw new AppException("VALIDATION_FAILED");
    await this.getLocation(id, context);
    const provider = context.scopedProvider ?? this.provider;
    if (!provider.getPerformance)
      return {
        ...range.data,
        totalInteractions: 0,
        daily: [],
        impressions: {},
        searchKeywords: [],
        keywordStartMonth: range.data.startDate.slice(0, 7),
        keywordEndMonth: range.data.endDate.slice(0, 7),
      };
    return provider.getPerformance(
      id,
      range.data,
      this.policy.providerContext(context),
    );
  }
  async listContent(
    id: string,
    kind: unknown,
    pageToken: unknown,
    context: UserContext,
  ) {
    const parsed = ContentKindSchema.safeParse(kind);
    if (
      !parsed.success ||
      (pageToken !== undefined &&
        (typeof pageToken !== "string" ||
          !pageToken ||
          pageToken.length > 4096))
    )
      throw new AppException("VALIDATION_FAILED");
    await this.getLocation(id, context);
    const provider = context.scopedProvider ?? this.provider;
    if (!provider.listContent)
      return {
        kind: parsed.data,
        available: false,
        items: [],
        nextPageToken: null,
        averageRating: null,
        totalReviews: null,
      };
    return provider.listContent(
      id,
      parsed.data,
      pageToken as string | undefined,
      this.policy.providerContext(context),
    );
  }
  async mutateContent(id: string, input: unknown, context: UserContext) {
    if (this.updatesDisabled) throw new AppException("PERMISSION_DENIED");
    this.policy.requirePermission(context, "location:write");
    const parsed = ContentCommandSchema.safeParse(input);
    if (!parsed.success) throw new AppException("VALIDATION_FAILED");
    await this.getLocation(id, context);
    const provider = context.scopedProvider ?? this.provider;
    if (!provider.mutateContent) throw new AppException("PERMISSION_DENIED");
    return provider.mutateContent(
      id,
      parsed.data,
      this.policy.providerContext(context),
    );
  }
  async uploadPhoto(
    id: string,
    file: { buffer: Buffer; mimetype: string } | undefined,
    category: unknown,
    context: UserContext,
  ) {
    if (this.updatesDisabled) throw new AppException("PERMISSION_DENIED");
    this.policy.requirePermission(context, "location:write");
    const parsed = PhotoCategorySchema.safeParse(category);
    const jpeg = file?.buffer
      .subarray(0, 3)
      .equals(Buffer.from([255, 216, 255]));
    const png = file?.buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (
      !parsed.success ||
      !file ||
      !file.buffer.length ||
      file.buffer.length > MAX_PHOTO_BYTES ||
      !(
        (jpeg && file.mimetype === "image/jpeg") ||
        (png && file.mimetype === "image/png")
      )
    )
      throw new AppException("VALIDATION_FAILED");
    await this.getLocation(id, context);
    const provider = context.scopedProvider ?? this.provider;
    if (!provider.uploadPhoto) throw new AppException("PERMISSION_DENIED");
    return provider.uploadPhoto(
      id,
      file,
      parsed.data,
      this.policy.providerContext(context),
    );
  }
  async updateLocation(id: string, input: unknown, context: UserContext) {
    if (this.updatesDisabled) throw new AppException("PERMISSION_DENIED");
    this.policy.requirePermission(context, "location:write");
    const parsed = UpdateLocationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppException("VALIDATION_FAILED", {
        violations: parsed.error.issues.map((issue) => ({
          field:
            issue.path[0] === "websiteUrl" || issue.path[0] === "primaryPhone"
              ? issue.path[0]
              : "input",
          reason: "INVALID" as const,
        })),
      });
    }
    const writable = parsed.data;
    // Resolve the resource through the provider and verify its actual account before writing.
    await this.getLocation(id, context);
    return (context.scopedProvider ?? this.provider).updateLocation(
      id,
      writable,
      this.policy.providerContext(context),
    );
  }
  async bulkUpdateLocations(
    input: unknown,
    context: UserContext,
  ): Promise<BulkLocationResult> {
    if (this.updatesDisabled) throw new AppException("PERMISSION_DENIED");
    this.policy.requirePermission(context, "location:write");
    const parsed = BulkLocationCommandSchema.safeParse(input);
    if (!parsed.success) throw new AppException("VALIDATION_FAILED");
    const command = parsed.data;
    this.policy.requireAccount(context, command.accountId);
    const results: BulkLocationResult["results"] = [];
    for (const locationId of command.selection.locationIds) {
      try {
        const detail = await this.getLocation(locationId, context);
        if (detail.accountId !== command.accountId)
          throw new AppException("PERMISSION_DENIED");
        let update: UpdateLocationInput;
        switch (command.operation) {
          case "SET_WEBSITE":
            update = { websiteUrl: command.websiteUrl };
            break;
          case "SET_PHONE":
            update = {
              primaryPhone: command.primaryPhone,
              additionalPhones: command.additionalPhones,
            };
            break;
          case "SET_REGULAR_HOURS":
            update = { regularHours: command.regularHours };
            break;
          case "SET_SPECIAL_HOURS":
            update = { specialHours: command.specialHours };
            break;
          case "SET_DESCRIPTION":
            update = { description: command.description };
            break;
          case "SET_SERVICE_ITEMS":
            update = { serviceItems: command.serviceItems };
            break;
          case "UPDATE_LABELS":
            update = {
              labels: [
                ...new Set([
                  ...(detail.labels ?? []).filter(
                    (label) => !command.remove.includes(label),
                  ),
                  ...command.add,
                ]),
              ],
            };
            break;
        }
        await this.updateLocation(locationId, update, context);
        results.push({ locationId, success: true });
      } catch (error) {
        results.push({
          locationId,
          success: false,
          reason: error instanceof AppException ? error.code : "INTERNAL_ERROR",
        });
      }
    }
    const succeeded = results.filter((result) => result.success).length;
    return {
      totalSelected: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  }
}

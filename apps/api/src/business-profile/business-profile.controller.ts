import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_PHOTO_BYTES } from "@gbp/contracts";
import {
  RequirePermissions,
  PermissionsGuard,
} from "../auth/permissions.guard";
import {
  Body,
  Post,
  UploadedFile,
  UseInterceptors,
  Patch,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SessionGuard, AuthenticatedRequest } from "../auth/session.guard";
import { AppException } from "../errors/app.exception";
import { BusinessProfileService } from "./business-profile.service";
import type { UserContext } from "./business-profile.provider";
import { parseLocationQuery } from "./location-query";
export const BUSINESS_PROFILE_SCOPE = Symbol("BusinessProfileScope");
@Controller("api")
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermissions("location:read")
export class BusinessProfileController {
  constructor(
    @Inject(BusinessProfileService)
    private readonly profiles: BusinessProfileService,
    @Inject(BUSINESS_PROFILE_SCOPE)
    private readonly accountsForUser: (
      userId: string,
      role: UserContext["role"],
      connectionId?: string,
    ) => Promise<Pick<UserContext, "accountIds" | "scopedProvider">>,
  ) {}
  private async context(request: AuthenticatedRequest): Promise<UserContext> {
    if (!request.sessionUser) throw new AppException("UNAUTHENTICATED");
    const connectionId = request.query.connectionId;
    if (connectionId !== undefined && typeof connectionId !== "string")
      throw new AppException("VALIDATION_FAILED");
    return {
      userId: request.sessionUser.id,
      role: request.sessionUser.role,
      ...(await this.accountsForUser(
        request.sessionUser.id,
        request.sessionUser.role,
        connectionId,
      )),
      connectionId,
    };
  }
  @Get("accounts")
  async accounts(@Req() request: AuthenticatedRequest) {
    return this.profiles.listAccounts(await this.context(request));
  }
  @Get("accounts/:id/performance")
  async accountPerformance(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.getAccountPerformance(
      id,
      Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== "connectionId"),
      ),
      await this.context(request),
    );
  }
  @Get("accounts/:id/locations")
  async locations(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.listLocations(
      id,
      parseLocationQuery(
        Object.fromEntries(
          Object.entries(query).filter(([key]) => key !== "connectionId"),
        ),
      ),
      await this.context(request),
    );
  }
  @RequirePermissions("location:write")
  @Patch("locations/bulk")
  async bulkUpdateLocations(
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.bulkUpdateLocations(
      input,
      await this.context(request),
    );
  }
  @RequirePermissions("location:write")
  @Patch("locations/:id")
  async updateLocation(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.updateLocation(id, input, await this.context(request));
  }
  @Get("locations/:id/performance")
  async performance(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.getPerformance(
      id,
      Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== "connectionId"),
      ),
      await this.context(request),
    );
  }
  @Get("locations/:id/content/:kind")
  async content(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Query("pageToken") pageToken: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.listContent(
      id,
      kind,
      pageToken,
      await this.context(request),
    );
  }
  @Post("locations/:id/content")
  @RequirePermissions("location:write")
  async mutateContent(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.mutateContent(id, input, await this.context(request));
  }
  @Post("locations/:id/photos/upload")
  @RequirePermissions("location:write")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_PHOTO_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 100,
      },
    }),
  )
  async uploadPhoto(
    @Param("id") id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Body("category") category: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.uploadPhoto(
      id,
      file,
      category,
      await this.context(request),
    );
  }
  @Get("locations/:id")
  async location(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.getLocation(id, await this.context(request));
  }
}

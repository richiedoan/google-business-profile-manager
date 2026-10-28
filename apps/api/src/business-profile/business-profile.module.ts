import { GoogleConnectionsService } from "./google-connections.service";
import { GoogleConnectionsController } from "./google-connections.controller";
import { readGoogleConnectionSettings } from "./google-connection-settings";
import { PrismaService } from "../database/prisma.service";
import { LocationPolicy } from "../auth/location-policy";
import { PermissionsGuard } from "../auth/permissions.guard";
import { AUTH_SETTINGS, type AuthSettings } from "../auth/auth-settings";
import { AuthModule } from "../auth/auth.module";
import {
  BusinessProfileController,
  BUSINESS_PROFILE_SCOPE,
} from "./business-profile.controller";
import { Module } from "@nestjs/common";
import {
  BUSINESS_PROFILE_PROVIDER,
  BusinessProfileProvider,
  UserContext,
} from "./business-profile.provider";
import { MockBusinessProfileProvider } from "./mock-business-profile.provider";
import { BusinessProfileService } from "./business-profile.service";
@Module({
  imports: [AuthModule],
  controllers: [BusinessProfileController, GoogleConnectionsController],
  providers: [
    {
      provide: GoogleConnectionsService,
      inject: [PrismaService, AUTH_SETTINGS],
      useFactory: (prisma: PrismaService, auth: AuthSettings) =>
        new GoogleConnectionsService(
          prisma,
          readGoogleConnectionSettings(process.env, auth),
        ),
    },
    {
      provide: BUSINESS_PROFILE_SCOPE,
      inject: [GoogleConnectionsService],
      useFactory:
        (connections: GoogleConnectionsService) =>
        async (
          userId: string,
          role: UserContext["role"],
          connectionId?: string,
        ) => {
          if (!connections.settings)
            return { accountIds: userId ? ["account-1"] : [] };
          const resolved = await connections.resolve(
            userId,
            role,
            connectionId,
          );
          return {
            accountIds: resolved?.context.accountIds ?? [],
            scopedProvider: resolved?.provider,
          };
        },
    },
    {
      provide: LocationPolicy,
      inject: [AUTH_SETTINGS],
      useFactory: (settings: AuthSettings) => new LocationPolicy(settings),
    },
    PermissionsGuard,
    {
      provide: BUSINESS_PROFILE_PROVIDER,
      useFactory: () => {
        return new MockBusinessProfileProvider({
          locationCount:
            process.env.MOCK_LOCATION_COUNT === undefined
              ? 1000
              : Number(process.env.MOCK_LOCATION_COUNT),
        });
      },
    },
    {
      provide: BusinessProfileService,
      inject: [BUSINESS_PROFILE_PROVIDER, LocationPolicy],
      useFactory: (provider: BusinessProfileProvider, policy: LocationPolicy) =>
        new BusinessProfileService(provider, policy),
    },
  ],
  exports: [BusinessProfileService, BUSINESS_PROFILE_PROVIDER],
})
export class BusinessProfileModule {}

import { APP_GUARD } from "@nestjs/core";
import { GOOGLE_SETTINGS, readGoogleSettings } from "./google/google-settings";
import {
  GOOGLE_IDENTITY_CLIENT,
  GoogleOidcClient,
} from "./google/google-identity.client";
import {
  OAUTH_TRANSACTION_REPOSITORY,
  PrismaOAuthTransactionRepository,
} from "./google/oauth-transaction.repository";
import { GoogleOAuthService } from "./google/google-oauth.service";
import { GoogleOAuthController } from "./google/google-oauth.controller";
import type { AuthSettings } from "./auth-settings";
import { Module } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AUTH_SETTINGS, readAuthSettings } from "./auth-settings";
import {
  SESSION_REPOSITORY,
  PrismaSessionRepository,
} from "./session.repository";
import { SessionService } from "./session.service";
import { SessionGuard, MutationGuard } from "./session.guard";
import { AuthController } from "./auth.controller";
@Module({
  controllers: [AuthController, GoogleOAuthController],
  providers: [
    PrismaService,
    {
      provide: GOOGLE_SETTINGS,
      inject: [AUTH_SETTINGS],
      useFactory: (auth: AuthSettings) => readGoogleSettings(auth),
    },
    { provide: GOOGLE_IDENTITY_CLIENT, useClass: GoogleOidcClient },
    {
      provide: OAUTH_TRANSACTION_REPOSITORY,
      useClass: PrismaOAuthTransactionRepository,
    },
    GoogleOAuthService,
    { provide: AUTH_SETTINGS, useFactory: () => readAuthSettings() },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    SessionService,
    SessionGuard,
    MutationGuard,
    { provide: APP_GUARD, useExisting: MutationGuard },
  ],
  exports: [SessionGuard, SessionService, AUTH_SETTINGS, PrismaService],
})
export class AuthModule {}

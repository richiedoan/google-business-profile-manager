import { hasPermission, type Permission } from "@gbp/contracts";
import type { UserContext } from "../business-profile/business-profile.provider";
import { AppException } from "../errors/app.exception";
import { readAuthSettings, type AuthSettings } from "./auth-settings";
export class LocationPolicy {
  constructor(private readonly settings: AuthSettings = readAuthSettings()) {}
  requirePermission(
    context: Pick<UserContext, "userId" | "role">,
    permission: Permission,
  ): void {
    if (!context.userId) throw new AppException("UNAUTHENTICATED");
    if (
      !this.settings.labAuthorization &&
      !hasPermission(context.role, permission)
    )
      throw new AppException("PERMISSION_DENIED");
  }
  providerContext(context: UserContext): UserContext {
    // Only the local mock comparison uses fabricated authority. Sessions and CSRF still apply.
    return this.settings.labAuthorization
      ? {
          userId: context.userId,
          role: "MANAGER",
          accountIds: ["account-1", "account-2"],
          connectionId: context.connectionId,
        }
      : context;
  }
  requireAccount(context: UserContext, accountId: string): void {
    if (
      !this.settings.labAuthorization &&
      !context.accountIds.includes(accountId)
    )
      throw new AppException("PERMISSION_DENIED");
  }
}

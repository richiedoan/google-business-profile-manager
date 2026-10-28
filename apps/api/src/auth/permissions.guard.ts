import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import { LocationPolicy } from "./location-policy";
import type { AuthenticatedRequest } from "./session.guard";
const PERMISSIONS = "locationPermissions";
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS, permissions);
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LocationPolicy) private readonly policy: LocationPolicy,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().sessionUser;
    if (!user) throw new AppException("UNAUTHENTICATED");
    for (const permission of this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS,
      [context.getHandler(), context.getClass()],
    ) ?? [])
      this.policy.requirePermission(
        { userId: user.id, role: user.role },
        permission,
      );
    return true;
  }
}

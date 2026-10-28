export type AppRole = "VIEWER" | "MANAGER";
export type Permission = "location:read" | "location:write";
const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  VIEWER: ["location:read"],
  MANAGER: ["location:read", "location:write"],
};
export function permissionsForRole(role: AppRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}
export function hasPermission(role: AppRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
export interface UserView {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  permissions: Permission[];
  languagePreference?: "en" | "vi" | null;
  themePreference?: "light" | "dark" | "system" | null;
}
export interface Account {
  id: string;
  name: string;
}

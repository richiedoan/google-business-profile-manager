export type ThemePreference = "light" | "dark" | "system";
export const themeStorageKey = "gbp-theme";

export function parseTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

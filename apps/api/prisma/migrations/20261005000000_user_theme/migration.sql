CREATE TYPE "ThemePreference" AS ENUM ('light', 'dark', 'system');
ALTER TABLE "User" ADD COLUMN "themePreference" "ThemePreference";

CREATE TYPE "LanguagePreference" AS ENUM ('en', 'vi');
ALTER TABLE "User" ADD COLUMN "languagePreference" "LanguagePreference";

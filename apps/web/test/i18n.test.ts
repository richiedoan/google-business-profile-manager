import { strict as assert } from "node:assert";
import { test } from "node:test";
import { translate, parseLanguage } from "../lib/i18n";
import { decodeUser } from "../lib/bff-client";

test("translations support Vietnamese, English fallback and named values", () => {
  assert.equal(translate("vi", "Sign in"), "Đăng nhập");
  assert.equal(translate("en", "Sign in"), "Sign in");
  assert.equal(
    translate("vi", "Select {name}", { name: "Cafe <1>" }),
    "Chọn Cafe <1>",
  );
  assert.equal(translate("vi", "Missing key"), "Missing key");
  assert.equal(parseLanguage("vi"), "vi");
  assert.equal(parseLanguage("fr"), "en");
});
test("user decoding retains and validates the account language", () => {
  const user = {
    id: "1",
    email: "a@example.test",
    displayName: "A",
    role: "VIEWER",
    permissions: ["location:read"],
  };
  assert.equal(
    decodeUser({ ...user, languagePreference: "vi" })?.languagePreference,
    "vi",
  );
  assert.equal(decodeUser(user)?.languagePreference, undefined);
  assert.throws(() => decodeUser({ ...user, languagePreference: "fr" }));
});

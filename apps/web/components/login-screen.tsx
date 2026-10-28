"use client";
import { useLanguage } from "../lib/i18n";
import { LoginPanel } from "./session-actions";
import { ThemeSelect } from "./theme-select";
import { LanguageSelect } from "./language-select";
export function LoginScreen({ allowLocalLogin }: { allowLocalLogin: boolean }) {
  const { t } = useLanguage();
  return (
    <main className="login-page" id="main-content">
      <section className="card login-card" aria-labelledby="sign-in-title">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            GBP
          </span>
          <span>GBP Manager</span>
        </div>
        <div className="login-heading">
          <div>
            <h1 id="sign-in-title">{t("Sign in")}</h1>
            <p>
              {t("Use your Google account to manage your business profiles.")}
            </p>
          </div>
        </div>
        <LoginPanel allowLocalLogin={allowLocalLogin} />
        <ThemeSelect />
        <LanguageSelect />
      </section>
    </main>
  );
}

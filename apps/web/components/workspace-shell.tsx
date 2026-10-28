"use client";

import { useLanguage } from "../lib/i18n";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoutButton } from "./session-actions";
import { useMe } from "../lib/auth";
import { LanguageSelect } from "./language-select";
import { ThemeSelect } from "./theme-select";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const locationsListView = /^\/app\/accounts\/[^/]+\/locations\/?$/.test(
    pathname,
  );
  const locationsView =
    pathname.startsWith("/app/accounts/") ||
    pathname.startsWith("/app/locations/");
  return (
    <div
      className={`workspace${locationsListView ? " workspace-locations-list" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        {" "}
        {t("Skip to content")}{" "}
      </a>
      <aside className="sidebar">
        <Link className="identity" href="/app">
          <span className="brand-mark" aria-hidden="true">
            GBP
          </span>
          <span>
            <strong>GBP Manager</strong>
            <small>{t("Profile management")}</small>
          </span>
        </Link>
        <button
          className="menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="sidebar-content"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? t("Close menu") : t("Menu")}
        </button>
        <div
          id="sidebar-content"
          className={`sidebar-content${menuOpen ? " is-open" : ""}`}
        >
          <div className="sidebar-rule" />
          <p className="nav-label">{t("WORKSPACE")}</p>
          <nav className="sidebar-nav" aria-label={t("Main navigation")}>
            <Link
              href="/app"
              aria-current={!locationsView ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <svg
                className="nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
              {t("Dashboard")}
            </Link>
            {locationsView && (
              <span className="nav-context">
                <svg
                  className="nav-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                {t("Locations")}
              </span>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-preferences">
              <ThemeSelect user={me.data ?? undefined} />
              <LanguageSelect user={me.data ?? undefined} />
            </div>
            <div className="sidebar-session">
              <LogoutButton />
            </div>
            <footer className="sidebar-footer">
              <span>{t("Built with AI support · Crafted by Richie Doan")}</span>
            </footer>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <main id="main-content" tabIndex={-1}>
          <div key={pathname} className="page-content">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

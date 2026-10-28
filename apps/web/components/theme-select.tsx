"use client";

import { useLanguage } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  parseTheme,
  themeStorageKey,
  type ThemePreference,
} from "../lib/theme";

import type { UserView } from "@gbp/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { bffClient, decodeUser } from "../lib/bff-client";
import { queryKeys } from "../lib/query-keys";

export function ThemeSelect({ user }: { user?: UserView }) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const [saveError, setSaveError] = useState(false);
  const queue = useRef(Promise.resolve());
  const initializedUser = useRef<string | null>(null);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  const save = (next: ThemePreference) => {
    const owner = userRef.current;
    if (!owner) return;
    setSaveError(false);
    queue.current = queue.current.then(async () => {
      if (userRef.current?.id !== owner.id) return;
      try {
        const updated = await bffClient.patch(
          "/api/me/preferences",
          decodeUser,
          undefined,
          { themePreference: next },
        );
        if (userRef.current?.id === owner.id) {
          client.setQueryData<UserView>(queryKeys.me, (current) =>
            current?.id === owner.id
              ? { ...current, themePreference: updated.themePreference }
              : current,
          );
          setSaveError(false);
        }
      } catch {
        if (userRef.current?.id === owner.id) setSaveError(true);
      }
    });
  };

  const [preference, setPreference] = useState<ThemePreference>("system");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let current: ThemePreference = "system";
    const apply = () => {
      document.documentElement.dataset.theme =
        current === "system" ? (media.matches ? "dark" : "light") : current;
      setIsDark(document.documentElement.dataset.theme === "dark");
      setPreference(current);
    };
    const read = () => {
      try {
        current = parseTheme(localStorage.getItem(themeStorageKey));
      } catch {
        /* Use system when storage is unavailable. */
      }
      apply();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null) read();
    };
    const preferenceChanged = (event: Event) => {
      current = (event as CustomEvent<ThemePreference>).detail;
      apply();
    };
    read();
    media.addEventListener("change", apply);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("gbp-theme-change", preferenceChanged);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("gbp-theme-change", preferenceChanged);
    };
  }, []);

  useEffect(() => {
    if (!user || initializedUser.current === user.id) return;
    initializedUser.current = user.id;
    let local: string | null = null;
    try {
      local = localStorage.getItem(themeStorageKey);
    } catch {}
    const next = user.themePreference ?? parseTheme(local);
    try {
      localStorage.setItem(themeStorageKey, next);
    } catch {}
    window.dispatchEvent(new CustomEvent("gbp-theme-change", { detail: next }));
    // Migrate an existing browser choice when the account has no saved preference.
    if (user.themePreference == null && local !== null) save(next);
  }, [user]);

  return (
    <div className="theme-control">
      <div className="theme-switch-control">
        <span>{t("Appearance")}</span>
        <button
          type="button"
          className="theme-switch"
          role="switch"
          aria-label={t("Dark")}
          aria-checked={isDark}
          onClick={() => {
            const next: ThemePreference = isDark ? "light" : "dark";
            save(next);
            try {
              localStorage.setItem(themeStorageKey, next);
            } catch {
              /* Keep the selection for this session. */
            }
            window.dispatchEvent(
              new CustomEvent("gbp-theme-change", { detail: next }),
            );
          }}
        >
          <span className="theme-switch-track" aria-hidden="true">
            <span className="theme-switch-thumb" />
          </span>
          <span>{t(isDark ? "Dark" : "Light")}</span>
        </button>
      </div>
      {saveError && (
        <p className="theme-save-error" role="alert">
          {" "}
          {t("Saved in this browser. Account sync failed.")}{" "}
          <button type="button" onClick={() => save(preference)}>
            {" "}
            {t("Retry")}{" "}
          </button>
        </p>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UserView } from "@gbp/contracts";
import {
  useLanguage,
  languageStorageKey,
  parseLanguage,
  type Language,
} from "../lib/i18n";
import { bffClient, decodeUser } from "../lib/bff-client";
import { queryKeys } from "../lib/query-keys";
export function LanguageSelect({ user }: { user?: UserView }) {
  const { language, setLanguage, t } = useLanguage();
  const client = useQueryClient();
  const [saveError, setSaveError] = useState(false);
  const owner = useRef(user);
  owner.current = user;
  const initialized = useRef<string | null>(null);
  const queue = useRef(Promise.resolve());
  const save = (next: Language) => {
    const id = owner.current?.id;
    if (!id) return;
    queue.current = queue.current.then(async () => {
      if (owner.current?.id !== id) return;
      try {
        const updated = await bffClient.patch(
          "/api/me/preferences",
          decodeUser,
          undefined,
          { languagePreference: next },
        );
        if (owner.current?.id === id) {
          // Preserve other preference changes that may have completed concurrently.
          client.setQueryData<UserView>(queryKeys.me, (current) =>
            current?.id === id
              ? { ...current, languagePreference: updated.languagePreference }
              : current,
          );
          setSaveError(false);
        }
      } catch {
        if (owner.current?.id === id) setSaveError(true);
      }
    });
  };
  useEffect(() => {
    if (!user) {
      initialized.current = null;
      return;
    }
    if (initialized.current === user.id) return;
    initialized.current = user.id;
    let local: string | null = null;
    try {
      local = localStorage.getItem(languageStorageKey);
    } catch {}
    const next = user.languagePreference ?? parseLanguage(local);
    setLanguage(next);
    if (user.languagePreference == null && local !== null) save(next);
  }, [user]);
  return (
    <div className="theme-control">
      <label className="theme-select">
        {t("Language")}
        <select
          value={language}
          onChange={(event) => {
            const next = parseLanguage(event.target.value);
            setLanguage(next);
            save(next);
          }}
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </label>
      {saveError && (
        <p role="alert" className="theme-save-error">
          {t("Saved in this browser. Account sync failed.")}{" "}
          <button type="button" onClick={() => save(language)}>
            {t("Retry")}
          </button>
        </p>
      )}
    </div>
  );
}

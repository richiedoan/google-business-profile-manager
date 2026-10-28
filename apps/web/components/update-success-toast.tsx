"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../lib/i18n";

export function UpdateSuccessToast({
  count,
  onDismiss,
}: {
  count: number;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [count, onDismiss]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="update-success-toast" role="status" aria-live="polite">
      <span aria-hidden="true">✓</span>
      <span>
        {count} {t("updated successfully")}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("Dismiss notification")}
        title={t("Dismiss notification")}
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}

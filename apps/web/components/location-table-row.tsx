"use client";
import { useLanguage } from "../lib/i18n";
import Link from "next/link";
import type { Ref } from "react";
import type { LocationSummary } from "@gbp/contracts";
import { withConnection } from "../lib/google-connections";
import { statusLabels } from "../lib/business-profile";
import { TruncatedText } from "./truncated-text";

export function LocationTableRow({
  location,
  connectionId,
  selected,
  canSelect,
  onSelect,
  rowRef,
  rowIndex,
}: {
  location: LocationSummary;
  connectionId?: string;
  selected: boolean;
  canSelect: boolean;
  onSelect: (checked: boolean) => void;
  rowRef?: Ref<HTMLTableRowElement>;
  rowIndex?: number;
}) {
  const { t } = useLanguage();
  const href = withConnection(
    `/app/locations/${encodeURIComponent(location.id)}`,
    connectionId,
  );
  return (
    <tr
      ref={rowRef}
      data-index={rowIndex}
      data-location-id={location.id}
      aria-rowindex={rowIndex === undefined ? undefined : rowIndex + 2}
      data-selected={canSelect && selected}
      data-selectable={canSelect}
      onClick={(event) => {
        if (!canSelect) return;
        if (
          event.target instanceof Element &&
          event.target.closest(
            "a, button, input, select, textarea, label, [role='button']",
          )
        )
          return;
        onSelect(!selected);
      }}
    >
      <td>
        <div className="location-cell">
          {canSelect && (
            <input
              type="checkbox"
              aria-label={t("Select {name}", { name: location.name })}
              title={t(selected ? "Deselect {name}" : "Select {name}", {
                name: location.name,
              })}
              checked={selected}
              onChange={(event) => onSelect(event.target.checked)}
            />
          )}
          <div className="location-title">
            <span className="location-name">
              <TruncatedText text={location.name} />
            </span>
            {location.storeCode && (
              <span className="location-secondary">
                <TruncatedText
                  text={t("Store code: {code}", { code: location.storeCode })}
                />
              </span>
            )}
          </div>
          <Link
            href={href}
            className="location-detail-button"
            aria-label={t("View details for {name}", { name: location.name })}
            title={t("View details for {name}", { name: location.name })}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
        </div>
      </td>
      <td>
        <TruncatedText text={location.formattedAddress || t("Not provided")} />
      </td>
      <td>
        <TruncatedText text={location.primaryCategory || t("Not provided")} />
      </td>
      <td>
        <mark data-status={location.status}>
          {t(statusLabels[location.status])}
        </mark>
      </td>
      <td>
        <TruncatedText
          text={
            location.providerState === "READ"
              ? t("Google read")
              : location.providerState === "MOCK"
                ? t("Mock provider")
                : t("Provider state unavailable")
          }
        />
        <span className="location-secondary">{t("No sync timestamp")}</span>
      </td>
    </tr>
  );
}

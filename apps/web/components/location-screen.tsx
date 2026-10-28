"use client";

import { UpdateSuccessToast } from "./update-success-toast";

import { useLanguage } from "../lib/i18n";
import { withConnection } from "../lib/google-connections";
import { LocationDetailSections } from "./location-detail-sections";
import { PerformanceTab } from "./performance-tab";
import { LocationContentTab } from "./location-content-tab";
import { useState } from "react";
import type { BulkLocationCommand, LocationDetail } from "@gbp/contracts";
import { useMe } from "../lib/auth";
import { BulkLocationDraft } from "./bulk-location-draft";
import Link from "next/link";
import { useLocation } from "../lib/business-profile";
import { ErrorState, LocationDetailSkeleton } from "./data-states";
const locationTabs = [
  "Profile",
  "Performance",
  "Photos & videos",
  "Posts",
  "Reviews",
];
const tabId = (name: string) => `location-tab-${locationTabs.indexOf(name)}`;
export function LocationScreen({
  id,
  updatesDisabled = true,
  connectionId,
}: {
  id: string;
  updatesDisabled?: boolean;
  connectionId?: string;
}) {
  const [updatedCount, setUpdatedCount] = useState<number | null>(null);
  const { t } = useLanguage();
  const [tab, setTab] = useState("Profile");
  const location = useLocation(id, connectionId);
  const me = useMe();
  const [editing, setEditing] = useState<{
    operation: BulkLocationCommand["operation"];
    data: LocationDetail;
  } | null>(null);
  const canEdit =
    !updatesDisabled && !!me.data?.permissions.includes("location:write");
  if (location.isPending) return <LocationDetailSkeleton />;
  if (location.isError)
    return (
      <ErrorState
        error={location.error}
        onRetry={() => {
          void location.refetch();
        }}
      />
    );
  const data = location.data;
  return (
    <>
      <Link
        className="back-link"
        href={withConnection(
          `/app/accounts/${encodeURIComponent(data.accountId)}/locations`,
          connectionId,
        )}
      >
        {" "}
        {t("← Account locations")}{" "}
      </Link>
      <div
        className="location-tabs"
        role="tablist"
        aria-label={t("Location detail")}
      >
        {locationTabs.map((name) => (
          <button
            key={name}
            id={tabId(name)}
            type="button"
            role="tab"
            tabIndex={tab === name ? 0 : -1}
            onKeyDown={(event) => {
              const names = locationTabs;
              const index = names.indexOf(name);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % names.length
                  : event.key === "ArrowLeft"
                    ? (index + names.length - 1) % names.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? names.length - 1
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                setTab(names[next]);
                document.getElementById(tabId(names[next]))?.focus();
              }
            }}
            aria-selected={tab === name}
            aria-controls="location-tab-panel"
            onClick={() => setTab(name)}
          >
            {t(name)}
          </button>
        ))}
      </div>
      <div
        key={tab}
        className="location-tab-panel content-enter"
        role="tabpanel"
        tabIndex={0}
        id="location-tab-panel"
        aria-labelledby={tabId(tab)}
      >
        {tab === "Performance" ? (
          <PerformanceTab
            key={`${connectionId ?? "default"}:${id}`}
            locationId={id}
            connectionId={connectionId}
          />
        ) : tab === "Photos & videos" ||
          tab === "Posts" ||
          tab === "Reviews" ? (
          <LocationContentTab
            key={`${connectionId ?? "default"}:${id}:${tab}`}
            locationId={id}
            connectionId={connectionId}
            kind={
              tab === "Photos & videos"
                ? "media"
                : tab === "Posts"
                  ? "posts"
                  : "reviews"
            }
            canWrite={canEdit}
          />
        ) : (
          <LocationDetailSections
            data={data}
            onEdit={
              canEdit
                ? (operation) => setEditing({ operation, data })
                : undefined
            }
          />
        )}
      </div>
      {updatedCount !== null && (
        <UpdateSuccessToast
          count={updatedCount}
          onDismiss={() => setUpdatedCount(null)}
        />
      )}
      {canEdit && editing && (
        <BulkLocationDraft
          key={`${data.id}:${editing.operation}`}
          accountId={data.accountId}
          connectionId={connectionId}
          selected={[{ id: data.id, name: data.name }]}
          open
          operation={editing.operation}
          initialData={editing.data}
          context="detail"
          onSuccess={setUpdatedCount}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

"use client";

import { AccountPerformanceOverview } from "./account-performance-overview";
import { UpdateSuccessToast } from "./update-success-toast";

import { useLanguage } from "../lib/i18n";
import { LocationTableRow } from "./location-table-row";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { locationVirtualRange } from "../lib/location-virtualization";
import { createPortal } from "react-dom";
import { useMe } from "../lib/auth";
import { withConnection } from "../lib/google-connections";
import { MAX_BULK_LOCATION_IDS } from "@gbp/contracts";
import { BulkLocationDraft } from "./bulk-location-draft";
import {
  locationSelectionScope,
  toggleLocationSelection,
  selectCurrentLocationPage,
  deselectCurrentLocationPage,
  type SelectedLocation,
} from "../lib/location-selection";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { LocationQuery } from "@gbp/contracts";
import { useInfiniteLocations, statusLabels } from "../lib/business-profile";
import {
  ErrorState,
  LocationsTableSkeleton,
  LocationsTableSkeletonRows,
} from "./data-states";
export function LocationsScreen({
  accountId,
}: {
  accountId: string;
  updatesDisabled?: boolean;
}) {
  const params = useSearchParams();
  const status = params.get("status");
  const query: LocationQuery = {
    page: 1,
    pageSize: 25,
    search: params.get("search") ?? "",
    ...(status === "OPEN" ||
    status === "TEMPORARILY_CLOSED" ||
    status === "PERMANENTLY_CLOSED"
      ? { status }
      : {}),
  };
  const { t } = useLanguage();
  const router = useRouter();
  const view = params.get("view") === "overview" ? "overview" : "locations";
  function switchView(nextView: string) {
    const next = new URLSearchParams(params.toString());
    next.set("view", nextView);
    router.push(
      `/app/accounts/${encodeURIComponent(accountId)}/locations?${next}`,
      { scroll: false },
    );
  }
  return (
    <div className="account-workspace">
      <header className="locations-heading">
        <h1>
          <Link
            className="locations-back"
            href={withConnection(
              "/app",
              params.get("connectionId") ?? undefined,
            )}
            title={t("Choose another account")}
          >
            <span aria-hidden="true">←</span> {t("Locations")}
          </Link>
        </h1>
        <p
          className="locations-account"
          title={t("Account: {id}", { id: accountId })}
        >
          <span>{t("Account:")}</span> {accountId}
        </p>
      </header>
      <div
        className="location-tabs account-view-tabs"
        role="tablist"
        aria-label={t("Account views")}
      >
        {["overview", "locations"].map((name) => (
          <button
            type="button"
            key={name}
            id={`account-tab-${name}`}
            role="tab"
            aria-selected={view === name}
            aria-controls="account-tab-panel"
            tabIndex={view === name ? 0 : -1}
            onClick={() => switchView(name)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "overview"
                    : event.key === "End"
                      ? "locations"
                      : name === "overview"
                        ? "locations"
                        : "overview";
                switchView(next);
                document.getElementById(`account-tab-${next}`)?.focus();
              }
            }}
          >
            {t(name === "overview" ? "Overview" : "Locations")}
          </button>
        ))}
      </div>
      <div
        id="account-tab-panel"
        className="account-tab-panel"
        role="tabpanel"
        aria-labelledby={`account-tab-${view}`}
      >
        {view === "overview" ? (
          <AccountPerformanceOverview
            key={`${accountId}:${params.get("connectionId") ?? "default"}`}
            accountId={accountId}
            connectionId={params.get("connectionId") ?? undefined}
          />
        ) : (
          <ScopedLocations
            key={`${params.get("connectionId") ?? ""}:${locationSelectionScope(accountId, query)}`}
            accountId={accountId}
            query={query}
          />
        )}
      </div>
    </div>
  );
}
function ScopedLocations({
  accountId,
  query,
}: {
  accountId: string;
  query: LocationQuery;
}) {
  const [updatedCount, setUpdatedCount] = useState<number | null>(null);
  const { t } = useLanguage();
  const params = useSearchParams();
  const router = useRouter();
  const connectionId = params.get("connectionId") ?? undefined;
  const locations = useInfiniteLocations(accountId, query, connectionId);
  const me = useMe();
  const canWrite = !!me.data?.permissions.includes("location:write");
  const [selected, setSelected] = useState<SelectedLocation[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [pendingFilters, setPendingFilters] = useState<URLSearchParams | null>(
    null,
  );
  const [limitNotice, setLimitNotice] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  useEffect(() => {
    if (!limitNotice) return;
    const timer = window.setTimeout(() => setToastVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [limitNotice]);
  function notifyLimit() {
    setLimitNotice((value) => value + 1);
    setToastVisible(true);
  }
  const currentItems = useMemo(
    () =>
      Array.from(
        new Map(
          (locations.data?.pages.flatMap((page) => page.items) ?? []).map(
            (item) => [item.id, item],
          ),
        ).values(),
      ),
    [locations.data],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableHeadRef = useRef<HTMLTableSectionElement>(null);
  const [headerHeight, setHeaderHeight] = useState(48);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIndex = useMemo(
    () =>
      focusedId ? currentItems.findIndex((item) => item.id === focusedId) : -1,
    [currentItems, focusedId],
  );
  const getItemKey = useCallback(
    (index: number) => currentItems[index].id,
    [currentItems],
  );
  const rangeExtractor = useCallback(
    (range: Parameters<typeof locationVirtualRange>[0]) =>
      locationVirtualRange(range, focusedIndex),
    [focusedIndex],
  );
  const virtualizer = useVirtualizer({
    count: currentItems.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 76,
    overscan: 8,
    paddingStart: headerHeight,
    scrollPaddingStart: headerHeight,
    rangeExtractor,
  });
  const virtualRows = virtualizer.getVirtualItems();
  useEffect(() => {
    const header = tableHeadRef.current;
    if (!header) return;
    const measure = () =>
      setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [locations.isPending, currentItems.length === 0]);
  const loadMoreRef = useRef<HTMLTableRowElement>(null);
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } =
    locations;
  useEffect(() => {
    const target = loadMoreRef.current;
    if (
      !target ||
      !hasNextPage ||
      isFetching ||
      isFetchNextPageError ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage({ cancelRefetch: false });
      },
      { root: scrollRef.current, rootMargin: "0px 0px 160px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    hasNextPage,
    isFetching,
    isFetchNextPageError,
    fetchNextPage,
    currentItems.length,
  ]);
  const currentIds = useMemo(
    () => new Set(currentItems.map((item) => item.id)),
    [currentItems],
  );
  const selectedIds = useMemo(
    () => new Set(selected.map((item) => item.id)),
    [selected],
  );
  const selectedOnPage = useMemo(
    () => selected.filter((item) => currentIds.has(item.id)).length,
    [selected, currentIds],
  );
  const additions = currentItems.length - selectedOnPage;
  const pageWouldExceedCap =
    selected.length + additions > MAX_BULK_LOCATION_IDS;
  function changeSelection(next: SelectedLocation[]) {
    setSelected(next);
    setReviewing(false);
  }

  function selectLocation(location: SelectedLocation, checked: boolean) {
    if (checked && selected.length >= MAX_BULK_LOCATION_IDS) {
      notifyLimit();
      return;
    }
    changeSelection(toggleLocationSelection(selected, location, checked));
  }

  function navigate(next: URLSearchParams) {
    router.push(
      `/app/accounts/${encodeURIComponent(accountId)}/locations?${next}`,
    );
  }
  return (
    <>
      {updatedCount !== null && (
        <UpdateSuccessToast
          count={updatedCount}
          onDismiss={() => setUpdatedCount(null)}
        />
      )}
      {canWrite && (
        <BulkLocationDraft
          accountId={accountId}
          connectionId={connectionId}
          open={reviewing}
          selected={selected}
          onSuccess={setUpdatedCount}
          onClose={() => setReviewing(false)}
        />
      )}
      <section
        className="card locations-table"
        aria-label={t("Business locations and selection")}
      >
        <form
          className="table-toolbar"
          aria-label={t("Filter locations")}
          key={`${query.search}:${query.status ?? ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const next = new URLSearchParams();
            if (connectionId) next.set("connectionId", connectionId);
            const search = String(data.get("search") ?? "").trim();
            const status = String(data.get("status") ?? "");
            if (search) next.set("search", search);
            if (status) next.set("status", status);
            next.set("page", "1");
            if (
              selected.length &&
              (search !== query.search || status !== (query.status ?? ""))
            ) {
              setPendingFilters(next);
            } else {
              navigate(next);
            }
          }}
        >
          <div className="table-filters">
            <label className="table-search">
              <span className="sr-only">{t("Search locations")}</span>
              <input
                name="search"
                type="search"
                placeholder={t("Search by name…")}
                defaultValue={query.search}
                title={query.search}
                onChange={(event) => {
                  event.currentTarget.title = event.currentTarget.value;
                }}
                maxLength={200}
              />
            </label>{" "}
            <label className="table-status">
              <span className="sr-only">{t("Location status")}</span>
              <select name="status" defaultValue={query.status ?? ""}>
                <option value="">{t("All statuses")}</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>{" "}
            <button type="submit" className="filter-apply">
              {" "}
              {t("Apply")}{" "}
            </button>
          </div>
        </form>
        {locations.isPending ? (
          <LocationsTableSkeleton />
        ) : locations.isError && !locations.data ? (
          <ErrorState
            error={locations.error}
            onRetry={() => {
              void locations.refetch();
            }}
          />
        ) : (
          <>
            {currentItems.length === 0 && !locations.hasNextPage ? (
              <div className="locations-empty" role="status">
                <div className="locations-empty-icon" aria-hidden="true">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                </div>
                <h2>
                  {t(
                    query.search || query.status
                      ? "No matching locations"
                      : "No locations yet",
                  )}
                </h2>
                <p>
                  {t(
                    query.search || query.status
                      ? "Try another name or clear your filters to see all locations."
                      : "This Business account has no locations to display. Try choosing another account.",
                  )}
                </p>
                {query.search || query.status ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = new URLSearchParams();
                      if (connectionId) next.set("connectionId", connectionId);
                      if (selected.length) setPendingFilters(next);
                      else navigate(next);
                    }}
                  >
                    {t("Clear filters")}
                  </button>
                ) : (
                  <Link href={withConnection("/app", connectionId)}>
                    {t("Choose another account")}
                  </Link>
                )}
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="table-scroll virtual-locations-scroll"
                role="region"
                aria-label={t("Business locations")}
                tabIndex={0}
              >
                <table
                  aria-rowcount={
                    locations.data?.pages[0]?.total != null
                      ? locations.data.pages[0].total + 1
                      : locations.hasNextPage
                        ? -1
                        : currentItems.length + 1
                  }
                >
                  <thead ref={tableHeadRef}>
                    <tr aria-rowindex={1}>
                      <th scope="col">
                        <div className="location-cell">
                          {canWrite && (
                            <input
                              type="checkbox"
                              aria-label={t("Select all loaded locations")}
                              title={t("Select all loaded locations")}
                              aria-checked={
                                selectedOnPage > 0 &&
                                selectedOnPage < currentItems.length
                                  ? "mixed"
                                  : selectedOnPage > 0
                              }
                              ref={(input) => {
                                if (input)
                                  input.indeterminate =
                                    selectedOnPage > 0 &&
                                    selectedOnPage < currentItems.length;
                              }}
                              checked={
                                currentItems.length > 0 &&
                                selectedOnPage === currentItems.length
                              }
                              disabled={!currentItems.length}
                              onChange={(event) => {
                                if (
                                  event.target.checked &&
                                  pageWouldExceedCap
                                ) {
                                  notifyLimit();
                                  return;
                                }
                                changeSelection(
                                  event.target.checked
                                    ? selectCurrentLocationPage(
                                        selected,
                                        currentItems,
                                      )
                                    : deselectCurrentLocationPage(
                                        selected,
                                        currentItems,
                                      ),
                                );
                              }}
                            />
                          )}
                          <span>{t("Location")}</span>
                        </div>
                      </th>
                      <th scope="col">{t("Address")}</th>
                      <th scope="col">{t("Category")}</th>
                      <th scope="col">{t("Status")}</th>
                      <th scope="col">{t("Last sync / Provider state")}</th>
                    </tr>
                  </thead>
                  <tbody
                    onFocusCapture={(event) => {
                      const row = (
                        event.target as HTMLElement
                      ).closest<HTMLTableRowElement>("tr[data-location-id]");
                      setFocusedId(row?.dataset.locationId ?? null);
                    }}
                    onBlurCapture={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setFocusedId(null);
                    }}
                  >
                    {virtualRows.map((virtualRow, index) => {
                      const location = currentItems[virtualRow.index];
                      const gap =
                        virtualRow.start -
                        (index === 0
                          ? headerHeight
                          : virtualRows[index - 1].end);
                      return (
                        <Fragment key={virtualRow.key}>
                          {gap > 0 && (
                            <tr
                              className="virtual-table-spacer"
                              aria-hidden="true"
                            >
                              <td colSpan={5} style={{ height: gap }} />
                            </tr>
                          )}
                          <LocationTableRow
                            key={location.id}
                            location={location}
                            rowRef={virtualizer.measureElement}
                            rowIndex={virtualRow.index}
                            canSelect={canWrite}
                            connectionId={connectionId}
                            selected={selectedIds.has(location.id)}
                            onSelect={(checked) =>
                              selectLocation(location, checked)
                            }
                          />
                        </Fragment>
                      );
                    })}
                    {virtualizer.getTotalSize() -
                      (virtualRows.at(-1)?.end ?? headerHeight) >
                      0 && (
                      <tr className="virtual-table-spacer" aria-hidden="true">
                        <td
                          colSpan={5}
                          style={{
                            height:
                              virtualizer.getTotalSize() -
                              (virtualRows.at(-1)?.end ?? headerHeight),
                          }}
                        />
                      </tr>
                    )}
                    {locations.isFetchingNextPage && (
                      <LocationsTableSkeletonRows count={3} />
                    )}
                    {(locations.hasNextPage ||
                      locations.isFetchNextPageError) && (
                      <tr ref={loadMoreRef} className="load-more-row">
                        <td colSpan={5}>
                          {locations.isFetchNextPageError ? (
                            <ErrorState
                              error={locations.error}
                              onRetry={() => {
                                void locations.fetchNextPage();
                              }}
                            />
                          ) : locations.isFetchingNextPage ? (
                            <span className="sr-only" role="status">
                              {" "}
                              {t("Loading more locations…")}{" "}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={locations.isFetching}
                              onClick={() => {
                                void locations.fetchNextPage({
                                  cancelRefetch: false,
                                });
                              }}
                            >
                              {" "}
                              {t("Load more locations")}{" "}
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {currentItems.length > 0 && (
          <div className="table-pagination" role="status">
            <p>
              {currentItems.length} {t("locations loaded")}{" "}
              {locations.data?.pages[0]?.total != null &&
                t(" of {total}", { total: locations.data.pages[0].total })}
              {locations.data &&
                !locations.hasNextPage &&
                !locations.isFetching &&
                ` · ${t("All locations loaded")}`}
            </p>
          </div>
        )}
      </section>
      {canWrite &&
        selected.length > 0 &&
        createPortal(
          <div
            className="table-selection"
            role="region"
            aria-label={t("Selected locations")}
          >
            <p role="status">
              <strong>
                {selected.length} {t("selected")}
              </strong>{" "}
              <span className="selection-pages">
                · {selectedOnPage} {t("in loaded locations")}{" "}
              </span>
            </p>
            <div className="table-actions">
              <button type="button" onClick={() => changeSelection([])}>
                {" "}
                {t("Clear selection")}{" "}
              </button>
              {canWrite ? (
                <button
                  className="primary"
                  type="button"
                  disabled={reviewing || selected.length === 0}
                  onClick={() => setReviewing(true)}
                >
                  {" "}
                  {t("Review website draft")}{" "}
                </button>
              ) : (
                <span className="selection-permission">
                  {" "}
                  {t("Manager access required for bulk edits")}{" "}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}
      {pendingFilters && (
        <FilterChangeConfirmation
          count={selected.length}
          onCancel={() => setPendingFilters(null)}
          onConfirm={() => {
            navigate(pendingFilters);
            setPendingFilters(null);
          }}
        />
      )}
      {toastVisible &&
        createPortal(
          <div
            className="selection-toast"
            role="status"
            aria-live="polite"
            key={limitNotice}
          >
            <span>
              {" "}
              {t("You can select up to")} {MAX_BULK_LOCATION_IDS}{" "}
              {t("locations. Deselect some to continue.")}{" "}
            </span>
            <button
              type="button"
              aria-label={t("Dismiss notification")}
              title={t("Dismiss notification")}
              onClick={() => setToastVisible(false)}
            >
              ✕
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

function FilterChangeConfirmation({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialogRef.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      className="filter-confirmation"
      aria-labelledby="filter-confirmation-title"
      aria-describedby="filter-confirmation-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="filter-confirmation-title">{t("Change filters?")}</h2>
      <p id="filter-confirmation-description">
        {" "}
        {t("Changing filters will clear your selection of")} {count}{" "}
        {t("locations.")}{" "}
      </p>
      <div className="confirmation-actions">
        <button type="button" autoFocus onClick={onCancel}>
          {" "}
          {t("Keep current filters")}{" "}
        </button>
        <button className="primary" type="button" onClick={onConfirm}>
          {" "}
          {t("Change and clear selection")}{" "}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

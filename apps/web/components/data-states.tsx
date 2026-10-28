"use client";

import { useLanguage } from "../lib/i18n";
import { TruncatedText } from "./truncated-text";
import type { ApiErrorCode } from "@gbp/contracts";
import Link from "next/link";
import { BffError } from "../lib/bff-client";
const errorMessages: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  SESSION_EXPIRED: "Your session expired. Please sign in again.",
  PERMISSION_DENIED:
    "You do not have permission to view this account or location.",
  PROVIDER_RATE_LIMITED:
    "The business profile provider is busy. Wait a moment before retrying.",
  PROVIDER_ERROR:
    "The business profile provider is unavailable. Please try again shortly.",
  VALIDATION_FAILED: "The request is invalid. Check your input and try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  RESOURCE_NOT_FOUND: "This account or location could not be found.",
};
export function LoadingState({
  message = "Loading…",
  fullScreen = false,
}: {
  message?: string;
  fullScreen?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <p
      className={`loading-state${fullScreen ? " loading-screen" : ""}`}
      role="status"
    >
      <span className="loading-dot" aria-hidden="true" />
      {t(message)}
    </p>
  );
}
function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} />;
}
export function GoogleConnectionsSkeleton() {
  const { t } = useLanguage();
  return (
    <div
      className="connections-skeleton"
      role="status"
      aria-label={t("Loading Google connections…")}
    >
      <span className="sr-only">{t("Loading Google connections…")}</span>
      <div aria-hidden="true">
        <div className="section-heading">
          <Skeleton className="skeleton-heading" />
          <Skeleton className="skeleton-control" />
        </div>
        {[0, 1].map((row) => (
          <div className="google-connection" key={row}>
            <Skeleton className="skeleton-email" />
            <Skeleton className="skeleton-control" />
          </div>
        ))}
      </div>
    </div>
  );
}
export function AccountsSkeleton() {
  const { t } = useLanguage();
  return (
    <div role="status" aria-label={t("Loading accounts…")}>
      <span className="sr-only">{t("Loading accounts…")}</span>
      <div aria-hidden="true">
        <div className="section-heading">
          <Skeleton className="skeleton-heading" />
        </div>
        <ul className="account-grid">
          {[0, 1].map((row) => (
            <li key={row}>
              <div className="card account-card">
                <div className="account-copy">
                  <Skeleton className="skeleton-line" />
                  <Skeleton className="skeleton-short" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
export function LocationsTableSkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {Array.from({ length: 5 }, (_, column) => (
            <td key={column}>
              <Skeleton
                className={column === 3 ? "skeleton-badge" : "skeleton-line"}
              />
              {(column === 0 || column === 1 || column === 4) && (
                <Skeleton className="skeleton-short" />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
export function LocationsTableSkeleton() {
  const { t } = useLanguage();
  return (
    <div
      className="table-scroll loading-table"
      role="status"
      aria-label={t("Loading locations…")}
    >
      <span className="sr-only">{t("Loading locations…")}</span>
      <table aria-hidden="true">
        <thead>
          <tr>
            {[
              t("Location"),
              t("Address"),
              t("Category"),
              t("Status"),
              t("Last sync / Provider state"),
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <LocationsTableSkeletonRows />
        </tbody>
      </table>
    </div>
  );
}
export function LocationDetailSkeleton() {
  const { t } = useLanguage();
  return (
    <div role="status" aria-label={t("Loading location…")}>
      <span className="sr-only">{t("Loading location…")}</span>
      <div aria-hidden="true">
        <div className="back-link">
          <Skeleton className="skeleton-back" />
        </div>
        <div className="card location-detail-grid">
          {Array.from({ length: 6 }, (_, section) => (
            <div className="location-detail-section" key={section}>
              <h2>
                <Skeleton className="skeleton-heading" />
              </h2>
              <dl>
                {Array.from(
                  { length: section === 0 || section === 4 ? 5 : 3 },
                  (_, field) => (
                    <div className="location-detail-row" key={field}>
                      <dt>
                        <Skeleton className="skeleton-line" />
                      </dt>
                      <dd>
                        <Skeleton className="skeleton-line" />
                        {field === 1 && <Skeleton className="skeleton-short" />}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  message,
}: {
  title: string;
  message?: string;
}) {
  const { t } = useLanguage();
  return (
    <section className="card data-state">
      <h2>{title}</h2>
      {message && <p>{t(message)}</p>}
    </section>
  );
}
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="card data-state error-state" role="alert">
      <h2>{t("Unable to load data")}</h2>
      <p>
        {error instanceof BffError
          ? t(errorMessages[error.apiError.code])
          : t("Something went wrong. Please try again.")}
      </p>
      {error instanceof BffError &&
        error.apiError.requestId !== "unavailable" && (
          <p>
            <TruncatedText
              text={t("Request ID: {id}", { id: error.apiError.requestId })}
            />
          </p>
        )}
      {error instanceof BffError && error.status === 401 && (
        <Link href="/login">{t("Sign in again")}</Link>
      )}
      {onRetry &&
        !(error instanceof BffError && [401, 403].includes(error.status)) && (
          <button type="button" onClick={onRetry}>
            {" "}
            {t("Try again")}{" "}
          </button>
        )}
    </section>
  );
}

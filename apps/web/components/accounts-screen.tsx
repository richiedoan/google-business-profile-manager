"use client";

import { useLanguage } from "../lib/i18n";
import { TruncatedText } from "./truncated-text";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BffError } from "../lib/bff-client";
import {
  useGoogleConnections,
  useConnectGoogle,
  useDisconnectGoogle,
  withConnection,
} from "../lib/google-connections";
import { useAccounts } from "../lib/business-profile";
import { useMe } from "../lib/auth";
import {
  EmptyState,
  ErrorState,
  GoogleConnectionsSkeleton,
  AccountsSkeleton,
} from "./data-states";
export function AccountsScreen({
  connectionResult,
}: { connectionResult?: "success" | "error" } = {}) {
  const { t } = useLanguage();
  const connections = useGoogleConnections();
  const connect = useConnectGoogle();
  const disconnect = useDisconnectGoogle();
  const me = useMe();
  const userId = me.data?.id;
  const [selection, setSelection] = useState<{
    userId: string;
    id: string;
  } | null>(null);
  const selectionReady = !!userId && selection?.userId === userId;
  useEffect(() => {
    if (!userId) return;
    let id = "";
    try {
      id = localStorage.getItem(`gbp-google-connection:${userId}`) ?? "";
    } catch {
      // Selection still works in memory if browser storage is unavailable.
    }
    setSelection({ userId, id });
  }, [userId]);
  function selectConnection(id: string) {
    if (!userId) return;
    setSelection({ userId, id });
    try {
      localStorage.setItem(`gbp-google-connection:${userId}`, id);
    } catch {
      // Keep the current selection usable without persistent storage.
    }
  }
  const active =
    connections.data?.connections.filter((row) => row.status === "ACTIVE") ??
    [];
  const connectionId = selectionReady
    ? (active.find((row) => row.id === selection.id)?.id ?? active[0]?.id)
    : undefined;
  const restoringSelection = connections.data?.enabled && !selectionReady;
  useEffect(() => {
    if (
      !userId ||
      !selectionReady ||
      !connections.isSuccess ||
      !connections.data.enabled
    )
      return;
    try {
      if (connectionId)
        localStorage.setItem(`gbp-google-connection:${userId}`, connectionId);
      else localStorage.removeItem(`gbp-google-connection:${userId}`);
    } catch {
      // Storage is optional; the active connection is still validated above.
    }
  }, [
    userId,
    selectionReady,
    connectionId,
    connections.isSuccess,
    connections.data?.enabled,
  ]);
  const accounts = useAccounts(
    connectionId,
    connections.isSuccess &&
      (!connections.data.enabled || (selectionReady && !!connectionId)),
  );
  const client = useQueryClient();
  useEffect(() => {
    if (
      accounts.error instanceof BffError &&
      accounts.error.apiError.code === "UNAUTHENTICATED"
    ) {
      void client.invalidateQueries({ queryKey: ["google-connections"] });
    }
  }, [accounts.error, client]);
  const controls = (
    <section
      className="google-connections"
      aria-label={t("Google connections")}
    >
      {connectionResult === "success" && (
        <p role="status">{t("Google account connected.")}</p>
      )}
      {connectionResult === "error" && (
        <p role="alert">
          {" "}
          {t(
            "Unable to connect your Google account. Try granting access again.",
          )}{" "}
        </p>
      )}
      {connections.isPending && <GoogleConnectionsSkeleton />}
      {connections.isError && (
        <ErrorState
          error={connections.error}
          onRetry={() => {
            void connections.refetch();
          }}
        />
      )}
      {connections.data?.enabled && (
        <>
          <div className="section-heading">
            <h2>{t("Google accounts")}</h2>
            <button
              type="button"
              className="google-add-account"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
            >
              {" "}
              {t("Add Google account")}{" "}
            </button>
          </div>
          {connections.data.connections.length === 0 && (
            <p>
              {t(
                "Connect a Google account to view its Business profiles. Your app login stays the same.",
              )}
            </p>
          )}
          <div role="radiogroup" aria-label={t("Google accounts")}>
            {connections.data.connections.map((row) => (
              <div
                className="google-connection"
                data-selected={row.id === connectionId}
                key={row.id}
              >
                <label className="google-connection-choice">
                  <input
                    type="radio"
                    name="google-connection"
                    value={row.id}
                    checked={row.id === connectionId}
                    disabled={row.status !== "ACTIVE"}
                    onChange={() => selectConnection(row.id)}
                  />
                  <span className="google-connection-email">
                    <TruncatedText text={row.email} />
                  </span>
                  {row.id === connectionId && (
                    <span className="google-connection-status">
                      {t("Selected")}
                    </span>
                  )}
                  {row.status === "RECONNECT_REQUIRED" && (
                    <span className="google-connection-status">
                      {t("Reconnect required")}
                    </span>
                  )}
                </label>
                {row.status === "RECONNECT_REQUIRED" && (
                  <button
                    type="button"
                    disabled={connect.isPending}
                    onClick={() => connect.mutate()}
                  >
                    {t("Reconnect")}
                  </button>
                )}
                <details
                  className="google-connection-actions"
                  name="google-connection-actions"
                >
                  <summary
                    aria-label={t("Actions for {email}", { email: row.email })}
                  >
                    ⋯
                  </summary>
                  <div className="google-connection-popover">
                    <button
                      type="button"
                      disabled={disconnect.isPending}
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        disconnect.mutate(row.id);
                      }}
                    >
                      {t("Disconnect")}
                    </button>
                  </div>
                </details>
              </div>
            ))}
          </div>
          {connect.isError && (
            <ErrorState
              error={connect.error}
              onRetry={() => connect.mutate()}
            />
          )}
          {disconnect.isError && (
            <ErrorState
              error={disconnect.error}
              onRetry={() => disconnect.reset()}
            />
          )}
        </>
      )}
    </section>
  );
  const needsConnection =
    connections.isSuccess &&
    connections.data.enabled &&
    selectionReady &&
    !connectionId;
  return (
    <div className="dashboard-home">
      <div className="page-heading">
        <h1>{t("Dashboard")}</h1>
      </div>
      {controls}
      {connections.isPending ||
      restoringSelection ||
      (connections.isSuccess && !needsConnection && accounts.isPending) ? (
        <AccountsSkeleton />
      ) : needsConnection ? (
        <EmptyState
          title={t("Connect a Google account")}
          message={t(
            "Use Add Google account to grant access to your Business profiles.",
          )}
        />
      ) : connections.isSuccess && accounts.isError ? (
        <ErrorState
          error={accounts.error}
          onRetry={() => {
            void accounts.refetch();
          }}
        />
      ) : connections.isSuccess && accounts.data ? (
        <>
          <div className="section-heading">
            <h2>
              {t("Business accounts")} ({accounts.data.length})
            </h2>
          </div>
          {accounts.data.length === 0 ? (
            <EmptyState
              title={t("No accounts available")}
              message={t("No business accounts are accessible to your user.")}
            />
          ) : (
            <ul className="account-grid">
              {accounts.data.map((account) => (
                <li key={account.id}>
                  <Link
                    className="card account-card"
                    href={withConnection(
                      `/app/accounts/${encodeURIComponent(account.id)}/locations`,
                      connectionId,
                    )}
                  >
                    <span className="account-copy">
                      <strong>
                        <TruncatedText text={account.name} />
                      </strong>
                      <span>{t("Manage locations")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useLanguage } from "../lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { bffClient, decodeHealth, decodeUser } from "../lib/bff-client";
import { useMe, authFailure } from "../lib/auth";
import { queryKeys } from "../lib/query-keys";
import { LoadingState, ErrorState } from "./data-states";
export function LoginPanel({ allowLocalLogin }: { allowLocalLogin: boolean }) {
  const { t } = useLanguage();
  const me = useMe();
  const client = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    if (me.isSuccess && me.data) router.replace("/app");
  }, [me.isSuccess, me.data, router]);
  const login = useMutation({
    mutationFn: () => bffClient.post("/auth/dev-login", decodeUser),
    onMutate: async () => {
      await client.cancelQueries();
    },
    onSuccess: (user) => {
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "me",
      });
      client.setQueryData(queryKeys.me, user);
      router.replace("/app");
    },
  });
  if (me.isPending) return <LoadingState message={t("Loading...")} />;
  if (me.data && !me.isError)
    return <LoadingState message={t("Opening dashboard…")} />;
  const failure = authFailure(me.error);
  return (
    <>
      {failure === "expired" ? (
        <p role="alert">{t("Your session has expired. Sign in again.")}</p>
      ) : null}
      {me.isError && !failure && (
        <ErrorState
          error={me.error}
          onRetry={() => {
            void me.refetch();
          }}
        />
      )}
      <p>
        <a
          className="button primary google-login"
          href={bffClient.googleLoginUrl}
        >
          <span className="google-mark" aria-hidden="true">
            G
          </span>{" "}
          {t("Sign in with Google")}
          <span aria-hidden="true">↗</span>
        </a>
      </p>
      {allowLocalLogin ? (
        <>
          <p>{t("Development access")}</p>
          <button
            type="button"
            disabled={login.isPending || (me.isError && !failure)}
            onClick={() => login.mutate()}
          >
            {login.isPending ? t("Signing in…") : t("Sign in locally")}
          </button>
        </>
      ) : null}
      {login.isError && <ErrorState error={login.error} />}
    </>
  );
}
export function LogoutButton() {
  const { t } = useLanguage();
  const client = useQueryClient();
  const router = useRouter();
  const logout = useMutation({
    mutationFn: () => bffClient.post("/api/logout", decodeHealth),
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      client.setQueryData(queryKeys.me, null);
      router.replace("/login");
    },
  });
  return (
    <>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {logout.isPending ? t("Signing out…") : t("Sign out")}
      </button>
      {logout.isError && <ErrorState error={logout.error} />}
    </>
  );
}

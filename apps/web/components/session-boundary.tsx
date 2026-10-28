"use client";

import { useLanguage } from "../lib/i18n";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMe, authFailure } from "../lib/auth";
import { LoadingState, ErrorState } from "./data-states";
export function SessionBoundary({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const me = useMe();
  const router = useRouter();
  const failure = authFailure(me.error);
  useEffect(() => {
    if (failure === "unauthenticated" || (me.isSuccess && me.data === null))
      router.replace("/login");
  }, [failure, me.isSuccess, me.data, router]);
  if (me.isPending)
    return <LoadingState message={t("Loading...")} fullScreen />;
  if (failure === "expired")
    return (
      <section role="alert">
        <h1>{t("Session expired")}</h1>
        <p>{t("Please sign in again to continue.")}</p>
        <Link href="/login">{t("Sign in again")}</Link>
      </section>
    );
  if (failure === "unauthenticated" || (me.isSuccess && me.data === null))
    return <LoadingState message={t("Redirecting to sign in…")} fullScreen />;
  if (me.isError)
    return (
      <ErrorState
        error={me.error}
        onRetry={() => {
          void me.refetch();
        }}
      />
    );
  return <>{children}</>;
}

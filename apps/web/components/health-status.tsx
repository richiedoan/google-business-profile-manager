"use client";

import { useLanguage } from "../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { bffClient, decodeHealth } from "../lib/bff-client";
import { ErrorState, LoadingState } from "./data-states";
export function HealthStatus() {
  const { t } = useLanguage();
  const query = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => bffClient.get("/health", decodeHealth, signal),
  });
  if (query.isPending)
    return <LoadingState message={t("Checking API availability…")} />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <p role="status">
      {t("API status:")} {query.data.status}
    </p>
  );
}

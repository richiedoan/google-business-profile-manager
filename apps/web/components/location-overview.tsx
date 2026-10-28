"use client";
import { useLanguage } from "../lib/i18n";
import type { ReactNode } from "react";
import type { LocationDetail } from "@gbp/contracts";
import { statusLabels } from "../lib/business-profile";
export function LocationOverview({
  data,
  contactEditor,
}: {
  data: LocationDetail;
  contactEditor: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="location-overview">
      <section
        className="card overview-card"
        aria-label={t("Location overview")}
      >
        <div className="detail-card-heading">
          <h2>{t("Location information")}</h2>
          <mark data-status={data.status}>{t(statusLabels[data.status])}</mark>
        </div>
        <dl className="overview-fields">
          <dt>{t("Address")}</dt>
          <dd>{data.formattedAddress || t("Address unavailable")}</dd>
          <dt>{t("Category")}</dt>
          <dd>{data.primaryCategory ?? t("Category unavailable")}</dd>
          <dt>{t("Store code")}</dt>
          <dd>{data.storeCode || "—"}</dd>
          <dt>{t("Verification")}</dt>
          <dd>
            {data.verificationStatus === "VERIFIED"
              ? t("Verified")
              : data.verificationStatus === "PENDING"
                ? t("Pending verification")
                : t("Unknown")}
          </dd>
        </dl>
      </section>
      <section
        className="card overview-card"
        aria-label={t("Contact information")}
      >
        <div className="detail-card-heading">
          <h2>{t("Contact information")}</h2>
        </div>
        <dl className="overview-fields">
          <dt>{t("Phone")}</dt>
          <dd>{data.primaryPhone ?? t("Phone unavailable")}</dd>
          <dt>{t("Website")}</dt>
          <dd>{data.websiteUrl ?? t("Website unavailable")}</dd>
        </dl>
        <div className="overview-editor">{contactEditor}</div>
      </section>
      {data.description && (
        <section className="card overview-card overview-description">
          <div className="detail-card-heading">
            <h2>{t("About this business")}</h2>
          </div>
          <p>{data.description}</p>
        </section>
      )}
    </div>
  );
}

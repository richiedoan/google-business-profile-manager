"use client";
import { useLanguage } from "../lib/i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  BulkLocationCommand,
  LocationDetail,
  LocationHoursPeriod,
} from "@gbp/contracts";
import { statusLabels } from "../lib/business-profile";

const value = (text?: string | number | null) =>
  text === undefined || text === null || text === "" ? "—" : text;
function linkUrl(text: string): string | null {
  try {
    const url = new URL(/^www\./i.test(text) ? `https://${text}` : text);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function LinkedText({
  text,
  website = false,
}: {
  text: string;
  website?: boolean;
}) {
  const direct = website ? linkUrl(text) : null;
  if (direct)
    return (
      <a href={direct} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  return (
    <>
      {text.split(/((?:https?:\/\/|www\.)[^\s<>]+)/gi).map((part, index) => {
        const candidate = part.replace(/[.,;:!?)}\]]+$/, "");
        const href = /^(?:https?:\/\/|www\.)/i.test(candidate)
          ? linkUrl(candidate)
          : null;
        return href ? (
          <span key={index}>
            <a href={href} target="_blank" rel="noopener noreferrer">
              {candidate}
            </a>
            {part.slice(candidate.length)}
          </span>
        ) : (
          part
        );
      })}
    </>
  );
}
function Items({ items }: { items?: string[] }) {
  const { t } = useLanguage();
  return items?.length ? (
    <ul className="detail-values">
      {items.map((item, index) => (
        <li key={index}>
          <LinkedText text={item} />
        </li>
      ))}
    </ul>
  ) : (
    <>{t("Not provided")}</>
  );
}
function ExpandableValue({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      setOverflows(element.scrollHeight > lineHeight * 8 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className="location-detail-value">
      <div
        ref={content}
        id={id}
        className="detail-expandable-content"
        data-collapsed={overflows && !expanded}
      >
        {children}
      </div>
      {overflows && (
        <button
          type="button"
          className="detail-expand-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={t(expanded ? "Collapse {field}" : "Expand {field}", {
            field: label,
          })}
          onClick={() => setExpanded((current) => !current)}
        >
          {t(expanded ? "Show less" : "Show more")}
        </button>
      )}
    </div>
  );
}
function Field({
  label,
  children,
  onEdit,
  collapsible = true,
}: {
  label: string;
  children: ReactNode;
  onEdit?: () => void;
  collapsible?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="location-detail-row">
      <dt>{label}</dt>
      <dd>
        {collapsible ? (
          <ExpandableValue label={label}>
            {typeof children === "string" ? (
              <LinkedText text={children} />
            ) : (
              children
            )}
          </ExpandableValue>
        ) : (
          <div className="location-detail-value">{children}</div>
        )}
        {onEdit && (
          <button
            type="button"
            className="detail-edit"
            aria-label={t("Edit {field}", { field: label })}
            title={t("Edit {field}", { field: label })}
            onClick={onEdit}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m16 3 5 5-12 12-6 1 1-6Z" />
              <path d="m14 5 5 5" />
            </svg>
          </button>
        )}
      </dd>
    </div>
  );
}
function Section({
  title,
  children,
  footer,
  fullWidth = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <section
      className={`location-detail-section${fullWidth ? " location-detail-full-width" : ""}`}
      aria-label={title}
    >
      <h2>{title}</h2>
      <dl>{children}</dl>
      {footer}
    </section>
  );
}
function Hours({ periods }: { periods?: LocationHoursPeriod[] }) {
  const { t } = useLanguage();
  return periods?.length ? (
    <ul className="detail-values detail-hours">
      {periods.map((period, index) => (
        <li key={index}>
          {value(period.openDay)} {value(period.openTime)} –{" "}
          {period.closeDay !== period.openDay && <>{value(period.closeDay)} </>}
          {value(period.closeTime)}
        </li>
      ))}
    </ul>
  ) : (
    <>{t("Not provided")}</>
  );
}
export function LocationDetailSections({
  data,
  contactEditor,
  onEdit,
}: {
  data: LocationDetail;
  contactEditor?: ReactNode;
  onEdit?: (operation: BulkLocationCommand["operation"]) => void;
}) {
  const { t } = useLanguage();
  const openStatus =
    data.openStatus === undefined ? data.status : data.openStatus;
  const places =
    data.serviceArea?.places.filter((place) => place.name?.trim()) ?? [];
  const services = new Map<
    string,
    NonNullable<LocationDetail["serviceItems"]>
  >();
  for (const item of data.serviceItems ?? []) {
    const category = item.category?.trim() || t("Other services");
    services.set(category, [...(services.get(category) ?? []), item]);
  }
  const edit = (operation: BulkLocationCommand["operation"]) =>
    onEdit ? () => onEdit(operation) : undefined;
  const serviceType = data.serviceArea?.businessType;
  const serviceTypeLabel =
    serviceType === "CUSTOMER_LOCATION_ONLY"
      ? t("Serves customers at their locations")
      : serviceType === "CUSTOMER_AND_BUSINESS_LOCATION"
        ? t("Serves customers on-site and at their locations")
        : null;
  const mapsUrl = new URL("https://www.google.com/maps/search/");
  mapsUrl.searchParams.set("api", "1");
  mapsUrl.searchParams.set(
    "query",
    [data.name, data.formattedAddress].filter(Boolean).join(", "),
  );
  if (data.placeId) mapsUrl.searchParams.set("query_place_id", data.placeId);

  return (
    <div className="card location-detail-grid">
      <Section title={t("Basic information")}>
        <Field label={t("Location title")}>{data.name}</Field>
        {data.storeCode && (
          <Field label={t("Store code")}>{data.storeCode}</Field>
        )}
        {data.primaryCategory && (
          <Field label={t("Primary category")}>{data.primaryCategory}</Field>
        )}
        {!!data.additionalCategories?.length && (
          <Field label={t("Additional categories")}>
            <Items items={data.additionalCategories} />
          </Field>
        )}
        {openStatus && (
          <Field label={t("Open status")}>
            <mark data-status={openStatus}>{t(statusLabels[openStatus])}</mark>
          </Field>
        )}
        {data.verificationStatus !== "UNKNOWN" && (
          <Field label={t("Verification")}>
            {t(
              data.verificationStatus === "VERIFIED"
                ? "Verified"
                : "Pending verification",
            )}
          </Field>
        )}
      </Section>
      {(data.primaryPhone ||
        data.additionalPhones?.length ||
        data.websiteUrl ||
        onEdit ||
        contactEditor) && (
        <Section title={t("Contact")} footer={contactEditor}>
          {(data.primaryPhone || onEdit) && (
            <Field label={t("Primary phone")} onEdit={edit("SET_PHONE")}>
              {data.primaryPhone || t("Not provided")}
            </Field>
          )}
          {!!data.additionalPhones?.length && (
            <Field label={t("Additional phones")} onEdit={edit("SET_PHONE")}>
              <Items items={data.additionalPhones} />
            </Field>
          )}
          {(data.websiteUrl || onEdit) && (
            <Field label={t("Website")} onEdit={edit("SET_WEBSITE")}>
              <LinkedText text={data.websiteUrl || t("Not provided")} website />
            </Field>
          )}
        </Section>
      )}
      <Section title={t("Address / Service area")}>
        {data.formattedAddress && (
          <Field label={t("Storefront address")}>{data.formattedAddress}</Field>
        )}
        {(places.length > 0 || serviceTypeLabel) && (
          <Field label={t("Service area")}>
            {serviceTypeLabel && <div>{serviceTypeLabel}</div>}
            {places.length > 0 && (
              <Items items={places.map((place) => place.name!)} />
            )}
          </Field>
        )}
        <Field label={t("Map")}>
          <a href={mapsUrl.href} target="_blank" rel="noopener noreferrer">
            {t("View on Google Maps")} ↗
          </a>
        </Field>
      </Section>
      {(data.regularHours?.length ||
        data.specialHours?.length ||
        data.moreHours?.some((hours) => hours.periods.length) ||
        onEdit) && (
        <Section title={t("Business hours")}>
          {(data.regularHours?.length || onEdit) && (
            <Field
              label={t("Regular hours")}
              collapsible={false}
              onEdit={edit("SET_REGULAR_HOURS")}
            >
              <Hours periods={data.regularHours} />
            </Field>
          )}
          {(data.specialHours?.length || onEdit) && (
            <Field
              label={t("Special hours")}
              collapsible={false}
              onEdit={edit("SET_SPECIAL_HOURS")}
            >
              {data.specialHours?.length ? (
                <ul className="detail-values detail-hours">
                  {data.specialHours.map((period, index) => (
                    <li key={index}>
                      {value(period.startDate)}
                      {period.endDate &&
                        period.endDate !== period.startDate &&
                        ` – ${period.endDate}`}
                      :{" "}
                      {period.closed === true
                        ? t("Closed")
                        : `${value(period.openTime)} – ${value(period.closeTime)}`}
                    </li>
                  ))}
                </ul>
              ) : (
                t("Not provided")
              )}
            </Field>
          )}
          {data.moreHours?.some((hours) => hours.periods.length) && (
            <Field label={t("More hours")} collapsible={false}>
              <ul className="detail-values">
                {data.moreHours
                  .filter((hours) => hours.periods.length)
                  .map((hours, index) => (
                    <li key={index}>
                      <strong>{hours.type}</strong>
                      <Hours periods={hours.periods} />
                    </li>
                  ))}
              </ul>
            </Field>
          )}
        </Section>
      )}
      {(data.description ||
        data.labels?.length ||
        services.size > 0 ||
        onEdit) && (
        <Section title={t("Profile")} fullWidth>
          {(data.description || onEdit) && (
            <Field label={t("Description")} onEdit={edit("SET_DESCRIPTION")}>
              <span className="detail-description">
                <LinkedText text={data.description || t("Not provided")} />
              </span>
            </Field>
          )}
          {(data.labels?.length || onEdit) && (
            <Field label={t("Labels")} onEdit={edit("UPDATE_LABELS")}>
              <Items items={data.labels} />
            </Field>
          )}
          {(services.size > 0 || onEdit) && (
            <Field
              label={t("Service items")}
              onEdit={edit("SET_SERVICE_ITEMS")}
            >
              {services.size > 0
                ? Array.from(services, ([category, items]) => (
                    <div className="detail-service-group" key={category}>
                      <h3>{category}</h3>
                      <ul className="detail-values detail-services">
                        {items.map((item, index) => (
                          <li key={index}>
                            <strong>
                              <LinkedText
                                text={item.name || t("Service item")}
                              />
                            </strong>
                            {item.price && <span> · {item.price}</span>}
                            {item.description && (
                              <div className="detail-description">
                                <LinkedText text={item.description} />
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                : t("Not provided")}
            </Field>
          )}
        </Section>
      )}
    </div>
  );
}

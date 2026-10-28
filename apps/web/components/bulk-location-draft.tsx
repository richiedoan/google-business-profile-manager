"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  BulkLocationCommandSchema,
  BulkLocationResultSchema,
  WEEK_DAYS,
  type LocationDetail,
  type BulkLocationCommand,
  type BulkLocationResult,
} from "@gbp/contracts";
import { useLanguage } from "../lib/i18n";
import { applyBulkLocationBatch } from "../lib/bulk-location-batch";
import { bulkLocationSummary } from "../lib/bulk-location-summary";
import { withConnection } from "../lib/google-connections";
import { bffClient } from "../lib/bff-client";
import { TruncatedText } from "./truncated-text";
import type { SelectedLocation } from "../lib/location-selection";
import { invalidateBulkLocationQueries } from "../lib/business-profile";

const fields = [
  ["SET_WEBSITE", "Website"],
  ["SET_PHONE", "Phone"],
  ["SET_REGULAR_HOURS", "Regular hours"],
  ["SET_SPECIAL_HOURS", "Special hours"],
  ["SET_DESCRIPTION", "Description / Profile"],
  ["UPDATE_LABELS", "Labels"],
  ["SET_SERVICE_ITEMS", "Service items"],
] as const;
type Period = { openTime: string; closeTime: string; closeDay?: string };
type Special = Period & { date: string; endDate?: string; closed: boolean };
type Service = {
  name: string;
  description: string;
  category: string;
  languageCode: string;
  price: string;
};
const period = (): Period => ({ openTime: "09:00", closeTime: "17:00" });
const split = (text: string) =>
  text
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

export function BulkLocationDraft({
  accountId,
  connectionId,
  selected,
  open,
  onClose,
  onSuccess,
  operation,
  initialData,
  context = "bulk",
}: {
  accountId: string;
  connectionId?: string;
  selected: readonly SelectedLocation[];
  open: boolean;
  onClose: () => void;
  onSuccess?: (count: number) => void;
  operation?: BulkLocationCommand["operation"];
  initialData?: LocationDetail;
  context?: "bulk" | "detail";
}) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const [dirty, setDirty] = useState<Set<BulkLocationCommand["operation"]>>(
    () => new Set(),
  );
  const [pending, setPending] = useState<BulkLocationCommand[]>([]);
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [additional, setAdditional] = useState("");
  const [description, setDescription] = useState("");
  const [addLabels, setAddLabels] = useState("");
  const [removeLabels, setRemoveLabels] = useState("");
  const [labelsTouched, setLabelsTouched] = useState(false);
  const [hours, setHours] = useState<Period[][]>(() => WEEK_DAYS.map(() => []));
  const [special, setSpecial] = useState<Special[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [command, setCommand] = useState<BulkLocationCommand[] | null>(null);
  const [result, setResult] = useState<BulkLocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy]);
  const selectionKey = selected
    .map((item) => item.id)
    .sort()
    .join("|");
  useEffect(() => {
    setCommand(null);
    setResult(null);
    setError(null);
    setDirty(new Set());
    setPending([]);
    setWebsite(initialData?.websiteUrl ?? "");
    setPhone(initialData?.primaryPhone ?? "");
    setAdditional(initialData?.additionalPhones?.join("\n") ?? "");
    setDescription(initialData?.description ?? "");
    setAddLabels("");
    setRemoveLabels("");
    setLabelsTouched(false);
    setHours(
      WEEK_DAYS.map((day) =>
        (initialData?.regularHours ?? [])
          .filter((p) => p.openDay?.toUpperCase() === day)
          .map((p) => ({
            openTime: p.openTime ?? "",
            closeTime: p.closeTime ?? "",
            closeDay: p.closeDay?.toUpperCase(),
          })),
      ),
    );
    setSpecial(
      (initialData?.specialHours ?? []).map((p) => ({
        date: p.startDate ?? "",
        endDate: p.endDate ?? undefined,
        closed: p.closed === true,
        openTime: p.openTime ?? "",
        closeTime: p.closeTime ?? "",
      })),
    );
    setServices(
      (initialData?.serviceItems ?? []).map((p) => ({
        name: p.name ?? "",
        description: p.description ?? "",
        category: p.category ?? "",
        languageCode: p.languageCode ?? "",
        price: p.price ?? "",
      })),
    );
  }, [open, accountId, connectionId, selectionKey, operation, initialData]);
  const changed = (operation: BulkLocationCommand["operation"]) => {
    setDirty((current) => new Set(current).add(operation));
    setPending([]);
    setCommand(null);
    setResult(null);
    setError(null);
  };
  const clearField = (operation: BulkLocationCommand["operation"]) => {
    setDirty((current) => {
      const next = new Set(current);
      next.delete(operation);
      return next;
    });
    setPending([]);
    setCommand(null);
    setResult(null);
    setError(null);
  };
  function validate(operation: BulkLocationCommand["operation"]) {
    let payload: Record<string, unknown>;
    switch (operation) {
      case "SET_WEBSITE":
        payload = { websiteUrl: website.trim() || null };
        break;
      case "SET_PHONE":
        payload = {
          primaryPhone: phone.trim() || null,
          additionalPhones: split(additional),
        };
        break;
      case "SET_DESCRIPTION":
        payload = { description: description.trim() || null };
        break;
      case "UPDATE_LABELS":
        payload = { add: split(addLabels), remove: split(removeLabels) };
        break;
      case "SET_REGULAR_HOURS":
        payload = {
          regularHours: hours.flatMap((periods, index) =>
            periods.map((p) => ({
              ...p,
              openDay: WEEK_DAYS[index],
              closeDay: p.closeDay || WEEK_DAYS[index],
            })),
          ),
        };
        break;
      case "SET_SPECIAL_HOURS":
        payload = {
          specialHours: special.map((p) => ({
            startDate: p.date,
            endDate: p.endDate || p.date,
            closed: p.closed,
            openTime: p.closed ? null : p.openTime,
            closeTime: p.closed ? null : p.closeTime,
          })),
        };
        break;
      case "SET_SERVICE_ITEMS":
        payload = {
          serviceItems: services.map((s) => ({
            ...s,
            description: s.description || null,
            category: s.category || null,
            languageCode: s.languageCode || null,
            price: s.price || null,
          })),
        };
        break;
    }
    const parsed = BulkLocationCommandSchema.safeParse({
      accountId,
      operation,
      selection: {
        kind: "EXPLICIT_IDS",
        locationIds: selected.map((s) => s.id),
      },
      ...payload,
    });
    return parsed;
  }
  const hasInput = (field: BulkLocationCommand["operation"]) => {
    switch (field) {
      case "SET_WEBSITE":
        return website.trim().length > 0;
      case "SET_PHONE":
        return phone.trim().length > 0 || split(additional).length > 0;
      case "SET_DESCRIPTION":
        return description.trim().length > 0;
      case "SET_REGULAR_HOURS":
        return hours.some((periods) => periods.length > 0);
      case "SET_SPECIAL_HOURS":
        return special.length > 0;
      case "SET_SERVICE_ITEMS":
        return services.length > 0;
      case "UPDATE_LABELS":
        return split(addLabels).length > 0 || split(removeLabels).length > 0;
    }
  };
  const validations = fields
    .filter(
      ([field]) =>
        (!operation || operation === field) &&
        dirty.has(field) &&
        hasInput(field),
    )
    .map(([operation]) => validate(operation));
  const valid =
    validations.length > 0 && validations.every((value) => value.success);
  const issues = validations.flatMap((value) =>
    value.success ? [] : value.error.issues,
  );
  function fieldError(path: string, children = true) {
    if ((path === "add" || path === "remove" || path === "") && !labelsTouched)
      return null;
    const messages = issues
      .filter((issue) => {
        const key = issue.path.join(".");
        return key === path || (children && key.startsWith(`${path}.`));
      })
      .map((issue) =>
        t(
          issue.path[0] === "additionalPhones" &&
            issue.code === "invalid_format"
            ? "Enter a phone number using digits, spaces, +, parentheses or hyphens."
            : issue.message,
        ),
      );
    return messages.length ? (
      <p className="bulk-field-error" role="alert">
        {[...new Set(messages)].join(" ")}
      </p>
    ) : null;
  }
  function review() {
    if (dirty.has("UPDATE_LABELS")) setLabelsTouched(true);
    if (!valid) return;
    setError(null);
    setCommand(
      pending.length
        ? pending
        : validations.flatMap((value) => (value.success ? [value.data] : [])),
    );
  }
  async function apply(value: BulkLocationCommand[]) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setCommand(null);
    setError(null);
    const previousResult = result;
    try {
      const batch = await applyBulkLocationBatch(value, (item) =>
        bffClient.patch(
          withConnection("/api/locations/bulk", connectionId),
          (v) => BulkLocationResultSchema.parse(v),
          undefined,
          item,
        ),
      );
      const response = batch.result;
      setPending(batch.pending);
      const combined = previousResult
        ? [
            ...previousResult.results.filter((r) => r.success),
            ...response.results,
          ]
        : response.results;
      const succeeded = combined.filter((r) => r.success).length;
      setResult({
        totalSelected: combined.length,
        succeeded,
        failed: combined.length - succeeded,
        results: combined,
      });
      try {
        await invalidateBulkLocationQueries(
          client,
          accountId,
          batch.updatedIds,
          connectionId,
        );
      } catch {
        /* Successful writes remain successful if a refetch fails. */
      }
      if (combined.length > 0 && succeeded === combined.length) {
        onSuccess?.(succeeded);
        onClose();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("Unable to update locations."),
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="draft-drawer"
      aria-labelledby="bulk-draft-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!running.current) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !running.current) onClose();
      }}
    >
      <section className="draft-panel">
        <div className="draft-body">
          <div className="draft-heading">
            <h2 id="bulk-draft-title">
              {operation ? t("Edit location field") : t("Bulk location update")}
            </h2>
            <button
              type="button"
              aria-label={t("Close bulk update")}
              title={t("Close bulk update")}
              disabled={busy}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          <form
            id="bulk-location-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              review();
            }}
          >
            <fieldset className="bulk-fields" disabled={busy}>
              {(!operation || operation === "SET_WEBSITE") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("SET_WEBSITE")}
                >
                  <legend className="bulk-section-heading">
                    <span>{t("Website")}</span>
                    <RemoveButton
                      disabled={busy}
                      visible={dirty.has("SET_WEBSITE")}
                      label={t("Clear website")}
                      text={t("Clear")}
                      onClick={() => {
                        clearField("SET_WEBSITE");
                        setWebsite("");
                      }}
                    />
                  </legend>
                  <label className="bulk-sr-only" htmlFor="bulk-website">
                    {t("Website for all selected locations")}
                  </label>
                  <input
                    id="bulk-website"
                    inputMode="url"
                    placeholder="https://example.com"
                    maxLength={2048}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                  {fieldError("websiteUrl")}
                  <p>
                    {t(
                      "Leave blank to keep the current website on every selected location.",
                    )}
                  </p>
                </fieldset>
              )}
              {(!operation || operation === "SET_PHONE") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("SET_PHONE")}
                >
                  <legend className="bulk-section-heading">
                    <span>{t("Phone")}</span>
                    <RemoveButton
                      disabled={busy}
                      visible={dirty.has("SET_PHONE")}
                      label={t("Clear phone numbers")}
                      text={t("Clear")}
                      onClick={() => {
                        clearField("SET_PHONE");
                        setPhone("");
                        setAdditional("");
                      }}
                    />
                  </legend>
                  <label htmlFor="bulk-phone">{t("Primary phone")}</label>
                  <input
                    id="bulk-phone"
                    type="tel"
                    maxLength={30}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  {fieldError("primaryPhone")}
                  <label htmlFor="bulk-additional">
                    {t("Additional phones (up to 2, one per line)")}
                  </label>
                  <textarea
                    id="bulk-additional"
                    rows={2}
                    value={additional}
                    onChange={(e) => setAdditional(e.target.value)}
                  />
                  {fieldError("additionalPhones")}
                  <p>{t("Leave blank to keep current phone numbers.")}</p>
                </fieldset>
              )}
              {(!operation || operation === "SET_DESCRIPTION") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("SET_DESCRIPTION")}
                >
                  <legend className="bulk-section-heading">
                    <span>{t("Description / Profile")}</span>
                    <RemoveButton
                      disabled={busy}
                      visible={dirty.has("SET_DESCRIPTION")}
                      label={t("Clear description")}
                      text={t("Clear")}
                      onClick={() => {
                        clearField("SET_DESCRIPTION");
                        setDescription("");
                      }}
                    />
                  </legend>
                  <label className="bulk-sr-only" htmlFor="bulk-description">
                    {t("Description / Profile")}
                  </label>
                  <textarea
                    id="bulk-description"
                    maxLength={750}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  {fieldError("description")}
                  <p>{description.length}/750</p>
                </fieldset>
              )}
              {(!operation || operation === "UPDATE_LABELS") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("UPDATE_LABELS")}
                >
                  <legend>{t("Labels")}</legend>
                  {initialData?.labels?.length ? (
                    <p>
                      {t("Current labels")}: {initialData.labels.join(", ")}
                    </p>
                  ) : null}
                  <label htmlFor="bulk-add-labels">
                    {t("Labels to add (one per line)")}
                  </label>
                  <textarea
                    id="bulk-add-labels"
                    rows={2}
                    value={addLabels}
                    onChange={(e) => setAddLabels(e.target.value)}
                    onBlur={() => setLabelsTouched(true)}
                  />
                  {fieldError("add")}
                  <label htmlFor="bulk-remove-labels">
                    {t("Labels to remove (one per line)")}
                  </label>
                  <textarea
                    id="bulk-remove-labels"
                    rows={2}
                    value={removeLabels}
                    onChange={(e) => setRemoveLabels(e.target.value)}
                    onBlur={() => setLabelsTouched(true)}
                  />
                  {fieldError("remove")}
                  {fieldError("", false)}
                  <p>
                    {t(
                      "Up to 10 labels per location, 50 characters each. Other labels are preserved.",
                    )}
                  </p>
                </fieldset>
              )}
              {(!operation || operation === "SET_REGULAR_HOURS") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("SET_REGULAR_HOURS")}
                >
                  <legend className="bulk-section-heading">
                    <span>{t("Regular hours")}</span>
                    <RemoveButton
                      disabled={busy}
                      visible={dirty.has("SET_REGULAR_HOURS")}
                      label={t("Clear regular hours")}
                      text={t("Clear")}
                      onClick={() => {
                        clearField("SET_REGULAR_HOURS");
                        setHours(WEEK_DAYS.map(() => []));
                      }}
                    />
                  </legend>
                  {WEEK_DAYS.map((day, index) => (
                    <fieldset key={day} className="bulk-hours-day">
                      <legend className="bulk-sr-only">{t(day)}</legend>
                      <div className="bulk-hours-day-heading">
                        <span aria-hidden="true">{t(day)}</span>
                        <label>
                          <input
                            type="checkbox"
                            checked={hours[index].length > 0}
                            onChange={(e) =>
                              setHours(
                                hours.map((p, i) =>
                                  i === index
                                    ? e.target.checked
                                      ? [period()]
                                      : []
                                    : p,
                                ),
                              )
                            }
                          />
                          {t("Open for business")}
                        </label>
                        {!hours[index].length && <p>{t("Closed")}</p>}
                      </div>
                      {hours[index].map((p, pi) => (
                        <div key={pi} className="bulk-hours-period">
                          <TimeInputs
                            value={p}
                            onChange={(v) =>
                              setHours(
                                hours.map((ps, i) =>
                                  i === index
                                    ? ps.map((p, j) => (j === pi ? v : p))
                                    : ps,
                                ),
                              )
                            }
                          />
                          {fieldError(
                            `regularHours.${hours.slice(0, index).reduce((total, periods) => total + periods.length, 0) + pi}`,
                          )}
                          <RemoveButton
                            disabled={busy}
                            label={t("Remove period")}
                            onClick={() => {
                              changed("SET_REGULAR_HOURS");
                              setHours(
                                hours.map((ps, i) =>
                                  i === index
                                    ? ps.filter((_, j) => j !== pi)
                                    : ps,
                                ),
                              );
                            }}
                          />
                        </div>
                      ))}
                      {hours[index].length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            changed("SET_REGULAR_HOURS");
                            setHours(
                              hours.map((ps, i) =>
                                i === index ? [...ps, period()] : ps,
                              ),
                            );
                          }}
                        >
                          {t("Add period")}
                        </button>
                      )}
                    </fieldset>
                  ))}
                  {fieldError("regularHours", false)}
                  <p>
                    {t(
                      "Replaces regular hours for the entire week. Leave blank to keep current regular hours.",
                    )}
                  </p>
                </fieldset>
              )}
              {(!operation || operation === "SET_SPECIAL_HOURS") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("SET_SPECIAL_HOURS")}
                >
                  <legend className="bulk-section-heading">
                    <span>{t("Special hours")}</span>
                    <RemoveButton
                      disabled={busy}
                      visible={dirty.has("SET_SPECIAL_HOURS")}
                      label={t("Clear special hours")}
                      text={t("Clear")}
                      onClick={() => {
                        clearField("SET_SPECIAL_HOURS");
                        setSpecial([]);
                      }}
                    />
                  </legend>
                  {special.map((p, index) => (
                    <fieldset key={index} className="bulk-item-row">
                      <legend>
                        {t("Date override")} {index + 1}
                      </legend>
                      <label>
                        {t("Date")}
                        <input
                          type="date"
                          required
                          value={p.date}
                          onChange={(e) =>
                            setSpecial(
                              special.map((p, i) =>
                                i === index
                                  ? { ...p, date: e.target.value }
                                  : p,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={p.closed}
                          onChange={(e) =>
                            setSpecial(
                              special.map((p, i) =>
                                i === index
                                  ? { ...p, closed: e.target.checked }
                                  : p,
                              ),
                            )
                          }
                        />
                        {t("Closed all day")}
                      </label>
                      {!p.closed && (
                        <TimeInputs
                          value={p}
                          onChange={(v) =>
                            setSpecial(
                              special.map((p, i) =>
                                i === index ? { ...p, ...v } : p,
                              ),
                            )
                          }
                        />
                      )}
                      {fieldError(`specialHours.${index}`)}
                      <RemoveButton
                        disabled={busy}
                        label={t("Remove override")}
                        onClick={() => {
                          changed("SET_SPECIAL_HOURS");
                          setSpecial(special.filter((_, i) => i !== index));
                        }}
                      />
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      changed("SET_SPECIAL_HOURS");
                      setSpecial([
                        ...special,
                        { ...period(), date: "", closed: false },
                      ]);
                    }}
                  >
                    {t("Add date override")}
                  </button>
                  {fieldError("specialHours", false)}
                  <p>
                    {t(
                      "Replaces all special hours. Leave blank to keep current special hours.",
                    )}
                  </p>
                </fieldset>
              )}
              {(!operation || operation === "SET_SERVICE_ITEMS") && (
                <fieldset
                  className="bulk-field-section"
                  disabled={busy}
                  onChange={() => changed("SET_SERVICE_ITEMS")}
                >
                  <legend className="bulk-section-heading">
                    <span>{t("Service items")}</span>
                    <RemoveButton
                      disabled={busy}
                      visible={dirty.has("SET_SERVICE_ITEMS")}
                      label={t("Clear service items")}
                      text={t("Clear")}
                      onClick={() => {
                        clearField("SET_SERVICE_ITEMS");
                        setServices([]);
                      }}
                    />
                  </legend>
                  {services.map((service, index) => (
                    <fieldset key={index} className="bulk-item-row">
                      <legend>
                        {t("Service item")} {index + 1}
                      </legend>
                      {(
                        [
                          "name",
                          "description",
                          "category",
                          "languageCode",
                          "price",
                        ] as const
                      ).map((key) => (
                        <label key={key}>
                          {t(
                            {
                              name: "Name",
                              description: "Description",
                              category: "Category",
                              languageCode: "Language code",
                              price: "Price",
                            }[key],
                          )}
                          <input
                            required={key === "name"}
                            value={service[key]}
                            onChange={(e) =>
                              setServices(
                                services.map((s, i) =>
                                  i === index
                                    ? { ...s, [key]: e.target.value }
                                    : s,
                                ),
                              )
                            }
                          />
                          {fieldError(`serviceItems.${index}.${key}`)}
                        </label>
                      ))}
                      <RemoveButton
                        disabled={busy}
                        label={t("Remove service")}
                        onClick={() => {
                          changed("SET_SERVICE_ITEMS");
                          setServices(services.filter((_, i) => i !== index));
                        }}
                      />
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      changed("SET_SERVICE_ITEMS");
                      setServices([
                        ...services,
                        {
                          name: "",
                          description: "",
                          category: "",
                          languageCode: "",
                          price: "",
                        },
                      ]);
                    }}
                  >
                    {t("Add service item")}
                  </button>
                  {fieldError("serviceItems", false)}
                  <p>
                    {t(
                      "Replaces all service items. Leave blank to keep current services.",
                    )}
                  </p>
                </fieldset>
              )}
            </fieldset>
            {error && <p role="alert">{error}</p>}
            {busy && <p role="status">{t("Updating…")}</p>}
            {result && (
              <div role="status">
                <p>
                  {result.totalSelected} {t("locations selected")}
                  <br />
                  {result.succeeded} {t("updated successfully")}
                  <br />
                  {result.failed} {t("failed")}
                </p>
                {result.failed > 0 && (
                  <details>
                    <summary>{t("Inspect failed locations")}</summary>
                    <ul>
                      {result.results
                        .filter((r) => !r.success)
                        .map((r) => (
                          <li key={r.locationId}>
                            <TruncatedText
                              text={
                                selected.find((s) => s.id === r.locationId)
                                  ?.name ?? r.locationId
                              }
                            />
                            : {!r.success && t(r.reason)}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </form>
        </div>
        <div className="draft-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            type="submit"
            form="bulk-location-form"
            disabled={
              busy || !valid || !selected.length || result?.failed === 0
            }
          >
            {busy
              ? t("Updating…")
              : result?.failed
                ? t("Retry failed locations")
                : t("Update")}
          </button>
        </div>
      </section>
      {command && (
        <UpdateConfirmation
          context={context}
          initialData={context === "detail" ? initialData : undefined}
          commands={command}
          selected={selected.filter((item) =>
            command.some((value) =>
              value.selection.locationIds.includes(item.id),
            ),
          )}
          onCancel={() => setCommand(null)}
          onConfirm={() => void apply(command)}
        />
      )}
    </dialog>,
    document.body,
  );
}

function RemoveButton({
  label,
  text = "Clear",
  onClick,
  disabled,
  visible = true,
}: {
  label: string;
  text?: string;
  visible?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  if (!visible) return null;

  return (
    <button
      type="button"
      className="bulk-remove bulk-clear"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {text}
    </button>
  );
}

function TimeInputs({
  value,
  onChange,
}: {
  value: Period;
  onChange: (value: Period) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <label>
        {t("Opening time")}
        <input
          type="time"
          required
          value={value.openTime}
          onChange={(e) => onChange({ ...value, openTime: e.target.value })}
        />
      </label>
      <label>
        {t("Closing time")}
        <input
          type="time"
          required
          value={value.closeTime}
          onChange={(e) => onChange({ ...value, closeTime: e.target.value })}
        />
      </label>
    </>
  );
}
function UpdateConfirmation({
  context,
  initialData,
  commands,
  selected,
  onCancel,
  onConfirm,
}: {
  context: "bulk" | "detail";
  initialData?: LocationDetail;
  commands: BulkLocationCommand[];
  selected: readonly SelectedLocation[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => focus?.focus();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="filter-confirmation update-confirmation"
      aria-labelledby="update-confirmation-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="update-confirmation-title">{t("Confirm location update")}</h2>
      {context === "bulk" && (
        <p>
          {selected.length}{" "}
          {t(
            selected.length === 1
              ? "location will be updated"
              : "locations will be updated",
          )}
        </p>
      )}
      <ul className="bulk-change-preview">
        {commands.map((command) => (
          <li key={command.operation}>
            <strong>
              {t(fields.find(([key]) => key === command.operation)![1])}
            </strong>
            <ul>
              {bulkLocationSummary(command, { initialData, t }).map(
                (line, index) => (
                  <li key={index}>{t(line)}</li>
                ),
              )}
            </ul>
          </li>
        ))}
      </ul>
      {context === "bulk" && (
        <details>
          <summary>
            {selected.length} {t("locations · View selection")}
          </summary>
          <ul>
            {selected.map((s) => (
              <li key={s.id}>
                <TruncatedText text={s.name} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="confirmation-actions">
        <button type="button" autoFocus onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          {t(context === "detail" ? "Update" : "OK")}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

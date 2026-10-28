import {
  WEEK_DAYS,
  type BulkLocationCommand,
  type LocationDetail,
} from "@gbp/contracts";
/** Human-readable preview of the exact normalized command awaiting confirmation. */
export function bulkLocationSummary(
  command: BulkLocationCommand,
  options: {
    initialData?: LocationDetail;
    t?: (key: string) => string;
  } = {},
): string[] {
  const t = options.t ?? ((key: string) => key);
  switch (command.operation) {
    case "SET_WEBSITE":
      return [command.websiteUrl ?? "Clear website"];
    case "SET_PHONE": {
      const initial = options.initialData;
      const lines: string[] = [];
      if (
        !initial ||
        command.primaryPhone !== (initial.primaryPhone?.trim() || null)
      ) {
        lines.push(
          `${t("Primary phone")}: ${command.primaryPhone ?? t("Clear")}`,
        );
      }
      if (
        !initial ||
        JSON.stringify(command.additionalPhones) !==
          JSON.stringify(initial.additionalPhones ?? [])
      ) {
        lines.push(
          `${t("Additional phones")}: ${command.additionalPhones.join(", ") || t("Clear")}`,
        );
      }
      return lines;
    }
    case "SET_DESCRIPTION":
      return [command.description ?? "Clear description"];
    case "UPDATE_LABELS":
      return [
        `Add labels: ${command.add.join(", ") || "None"}`,
        `Remove labels: ${command.remove.join(", ") || "None"}`,
      ];
    case "SET_REGULAR_HOURS":
      return WEEK_DAYS.map(
        (day) =>
          `${day}: ${
            command.regularHours
              .filter((p) => p.openDay === day)
              .map(
                (p) =>
                  `${p.openTime}–${p.closeTime}${p.closeDay !== day ? ` (${p.closeDay})` : ""}`,
              )
              .join(", ") || "Closed"
          }`,
      );
    case "SET_SPECIAL_HOURS":
      return command.specialHours.length
        ? command.specialHours.map(
            (p) =>
              `${p.startDate}${p.endDate !== p.startDate ? `–${p.endDate}` : ""}: ${p.closed ? "Closed all day" : `${p.openTime}–${p.closeTime}`}`,
          )
        : ["Clear special hours"];
    case "SET_SERVICE_ITEMS":
      return command.serviceItems.length
        ? command.serviceItems.map((s) =>
            [s.name, s.description, s.category, s.languageCode, s.price]
              .filter(Boolean)
              .join(" · "),
          )
        : ["Clear service items"];
  }
}

import type { BulkLocationCommand, BulkLocationResult } from "@gbp/contracts";

/** Keep failed field/location pairs so retries never repeat successful writes. */
export async function applyBulkLocationBatch(
  commands: readonly BulkLocationCommand[],
  send: (command: BulkLocationCommand) => Promise<BulkLocationResult>,
) {
  const failures = new Map<string, string[]>();
  const ids = new Set(
    commands.flatMap((command) => command.selection.locationIds),
  );
  const updatedIds = new Set<string>();
  const pending: BulkLocationCommand[] = [];
  for (const command of commands) {
    let response: BulkLocationResult["results"];
    try {
      response = (await send(command)).results;
    } catch (error) {
      response = command.selection.locationIds.map((locationId) => ({
        locationId,
        success: false as const,
        reason:
          error instanceof Error
            ? error.message
            : "Unable to update locations.",
      }));
    }
    const failedIds: string[] = [];
    for (const locationId of command.selection.locationIds) {
      const result = response.find((item) => item.locationId === locationId);
      if (result?.success) {
        updatedIds.add(locationId);
      } else {
        failedIds.push(locationId);
        failures.set(locationId, [
          ...(failures.get(locationId) ?? []),
          result?.reason ?? "Unable to update locations.",
        ]);
      }
    }
    if (failedIds.length)
      pending.push({
        ...command,
        selection: { kind: "EXPLICIT_IDS", locationIds: failedIds },
      });
  }
  const results: BulkLocationResult["results"] = [...ids].map((locationId) => {
    const reasons = failures.get(locationId);
    return reasons
      ? { locationId, success: false, reason: [...new Set(reasons)].join("; ") }
      : { locationId, success: true };
  });
  return {
    result: {
      totalSelected: ids.size,
      succeeded: ids.size - failures.size,
      failed: failures.size,
      results,
    },
    pending,
    updatedIds: [...updatedIds],
  };
}

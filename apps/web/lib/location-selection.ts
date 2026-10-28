import {
  MAX_BULK_LOCATION_IDS,
  type LocationQuery,
  type LocationSummary,
} from "@gbp/contracts";
export type SelectedLocation = Pick<LocationSummary, "id" | "name">;
/** Page is intentionally excluded. A changed account/filter remounts the selection scope. */
export function locationSelectionScope(
  accountId: string,
  query: LocationQuery,
): string {
  return JSON.stringify([accountId, query.search ?? "", query.status ?? ""]);
}
export function toggleLocationSelection(
  selected: readonly SelectedLocation[],
  location: SelectedLocation,
  checked: boolean,
): SelectedLocation[] {
  if (!checked) return selected.filter((item) => item.id !== location.id);
  if (
    selected.some((item) => item.id === location.id) ||
    selected.length >= MAX_BULK_LOCATION_IDS
  )
    return [...selected];
  return [...selected, { id: location.id, name: location.name }];
}
/** Atomic page selection: never silently selects only part of a page at the cap. */
export function selectCurrentLocationPage(
  selected: readonly SelectedLocation[],
  page: readonly SelectedLocation[],
): SelectedLocation[] {
  const additions = page.filter(
    (item) => !selected.some((existing) => existing.id === item.id),
  );
  if (selected.length + additions.length > MAX_BULK_LOCATION_IDS)
    return [...selected];
  return [...selected, ...additions.map(({ id, name }) => ({ id, name }))];
}
export function deselectCurrentLocationPage(
  selected: readonly SelectedLocation[],
  page: readonly SelectedLocation[],
): SelectedLocation[] {
  const ids = new Set(page.map((item) => item.id));
  return selected.filter((item) => !ids.has(item.id));
}

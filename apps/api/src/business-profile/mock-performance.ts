import type { PerformanceRange, PerformanceSummary } from "@gbp/contracts";
import type { MockLocationRecord } from "./mock-location.mapper";

const DAY = 86400000;
// FNV-1a: stable across processes, with no clock or random state.
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return result >>> 0;
}

export function mockPerformance(
  record: MockLocationRecord,
  range: PerformanceRange,
  connectionId = "default",
): PerformanceSummary {
  const result: PerformanceSummary = {
    ...range,
    totalInteractions: 0,
    daily: [],
    dailyMetrics: [],
    impressions: {},
    searchKeywords: [],
    keywordStartMonth: range.startDate.slice(0, 7),
    keywordEndMonth: range.endDate.slice(0, 7),
  };
  // Dedicated absence fixture uses the same shape as unavailable API data.
  if (record.id === "location-00003") return result;

  const seed = JSON.stringify([connectionId, record.id]);
  const low = record.id === "location-00004";
  const base =
    record.id === "location-00002" ? 320 : low ? 2 : 25 + (hash(seed) % 55);
  const missingBookings = low;
  const totals = { calls: 0, directions: 0, websiteClicks: 0, bookings: 0 };
  const impressions = {
    searchMobile: 0,
    searchDesktop: 0,
    mapsMobile: 0,
    mapsDesktop: 0,
  };
  const countsForDay = (time: number) => {
    const date = new Date(time).toISOString().slice(0, 10);
    const n = hash(`${seed}:${date}`);
    const weekend = [0, 6].includes(new Date(time).getUTCDay());
    const activity = Math.round(
      base * (weekend ? 1.2 : 0.9) * (0.65 + (n % 101) / 100),
    );
    const calls = Math.floor(activity * (0.21 + (n % 7) / 100));
    const directions = Math.floor(activity * 0.4);
    const bookings = missingBookings ? 0 : Math.floor(activity * 0.08);
    const websiteClicks = activity - calls - directions - bookings;
    const views = activity * (9 + (n % 8)) + (low ? n % 9 : 20);
    const searchMobile = Math.floor(views * 0.43);
    const searchDesktop = Math.floor(views * 0.19);
    const mapsMobile = Math.floor(views * 0.3);
    return {
      date,
      activity,
      calls,
      directions,
      bookings,
      websiteClicks,
      searchMobile,
      searchDesktop,
      mapsMobile,
      mapsDesktop: views - searchMobile - searchDesktop - mapsMobile,
    };
  };
  for (
    let time = Date.parse(range.startDate);
    time <= Date.parse(range.endDate);
    time += DAY
  ) {
    const day = countsForDay(time);
    result.daily.push({ date: day.date, interactions: day.activity });
    result.dailyMetrics!.push({
      date: day.date,
      calls: day.calls,
      directions: day.directions,
      websiteClicks: day.websiteClicks,
      ...(!missingBookings ? { bookings: day.bookings } : {}),
      searchMobile: day.searchMobile,
      searchDesktop: day.searchDesktop,
      mapsMobile: day.mapsMobile,
      mapsDesktop: day.mapsDesktop,
    });
    result.totalInteractions += day.activity;
    for (const key of Object.keys(totals) as Array<keyof typeof totals>)
      totals[key] += day[key];
    for (const key of Object.keys(impressions) as Array<
      keyof typeof impressions
    >)
      impressions[key] += day[key];
  }
  Object.assign(result, totals, { impressions });
  if (missingBookings) delete result.bookings;

  // Keywords represent whole overlapping months, matching the existing report labels.
  const monthStart = Date.parse(`${result.keywordStartMonth}-01`);
  const end = new Date(`${result.keywordEndMonth}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  let searchViews = 0;
  for (let time = monthStart; time < end.getTime(); time += DAY) {
    const day = countsForDay(time);
    searchViews += day.searchMobile + day.searchDesktop;
  }
  const title = record.title.toLowerCase();
  const category = (record.primaryCategory ?? "local business").toLowerCase();
  const city = record.address.split(",").at(-1)!.trim().toLowerCase();
  const keywords = [
    ...new Set([
      title,
      `${category} near me`,
      `${category} ${city}`,
      `${title.split(" ").slice(0, 2).join(" ")} ${category}`,
      `best ${category} nearby`,
      `${category} open now`,
    ]),
  ];
  result.searchKeywords = keywords.map((keyword, index) => ({
    keyword,
    impressions: Math.floor(
      searchViews * [0.3, 0.22, 0.16, 0.12, 0.08, 0.05][index],
    ),
  }));
  return result;
}

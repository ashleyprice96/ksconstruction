// Date helpers. Dates without time are ISO strings (YYYY-MM-DD).

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Weekday (0 Sunday to 6 Saturday) of an ISO date. */
export function weekday(iso: string): number {
  return new Date(iso + "T12:00:00Z").getUTCDay();
}

/** Local date, weekday and minutes since midnight of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { iso, weekday: weekday(iso), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export interface Cutoff { weekday: number; time: string; timezone: string }

/**
 * The week ending a claim belongs to, given when it was submitted.
 * Week ending = the cut-off day. A claim submitted at or after the cut-off time
 * on the cut-off day, or later in the week, belongs to the following week ending.
 */
export function weekEndingFor(submitted: Date, cutoff: Cutoff): string {
  const { iso, weekday: wd, minutes } = zonedParts(submitted, cutoff.timezone);
  const [h, m] = cutoff.time.split(":").map(Number);
  const cutoffMinutes = h * 60 + m;
  let daysAhead = (cutoff.weekday - wd + 7) % 7;
  if (daysAhead === 0 && minutes >= cutoffMinutes) daysAhead = 7;
  return addDays(iso, daysAhead);
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso) : iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

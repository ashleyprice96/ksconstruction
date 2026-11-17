import "server-only";
import { q1 } from "./db";
import { addDays, isoDate, weekEndingFor, type Cutoff } from "./dates";

async function get<T>(key: string): Promise<T> {
  const r = await q1<{ value: T }>("SELECT value FROM ops.settings WHERE key = $1", [key]);
  if (!r) throw new Error(`Missing setting ${key}`);
  return r.value;
}

export const settings = {
  cutoff: () => get<Cutoff>("cutoff"),
  paylessDays: () => get<number>("payless_days_before_payment"),
  paylessReasons: () => get<string[]>("payless_reasons"),
  minPhotos: () => get<Record<string, number>>("min_photos"),
  signatureRequired: () => get<Record<string, boolean>>("signature_required"),
};

/** The claim week the office is in right now, from the existing cut-off setting. */
export async function currentWeek(now = new Date()) {
  const cutoff = await settings.cutoff();
  const weekEnding = weekEndingFor(now, cutoff);
  return { cutoff, weekEnding, weekStart: addDays(weekEnding, -6), today: isoDate(now) };
}

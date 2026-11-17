// Money is calculated in whole pence to avoid floating point drift.

export function toPence(pounds: string | number | null | undefined): number {
  if (pounds === null || pounds === undefined || pounds === "") return 0;
  const n = typeof pounds === "number" ? pounds : Number(pounds);
  return Math.round(n * 100);
}

export function fromPence(p: number): string {
  return (p / 100).toFixed(2);
}

/** quantity x rate, rounded to the penny. Uses scaled integers. */
export function lineValuePence(quantity: string | number, rate: string | number): number {
  const qMilli = Math.round(Number(quantity) * 1000);
  const rTenThou = Math.round(Number(rate) * 10000);
  // qMilli * rTenThou is in units of 1e-7 pounds; pence = /1e5
  return Math.round((qMilli * rTenThou) / 100000);
}

/** percent (0-100) of a value, rounded to the penny. */
export function percentOfPence(percent: string | number, valuePence: number): number {
  return Math.round((Number(percent) * valuePence) / 100);
}

export function gbp(pounds: string | number | null | undefined): string {
  const n = typeof pounds === "number" ? pounds : Number(pounds ?? 0);
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

export function gbpPence(p: number): string {
  return gbp(p / 100);
}

/**
 * Scale an allocation to a new total, keeping proportions and balancing pennies
 * so the parts always add up exactly. Used when management reduces a claim.
 */
export function rescale(parts: number[], newTotal: number): number[] {
  const oldTotal = parts.reduce((a, b) => a + b, 0);
  if (oldTotal === 0) return parts.map(() => 0);
  const raw = parts.map((p) => (p * newTotal) / oldTotal);
  const floored = raw.map(Math.floor);
  let remainder = newTotal - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] += 1;
    remainder -= 1;
  }
  return floored;
}

/** A rate: shows up to four decimal places so agreed rates are never rounded on screen. */
export function gbpRate(rate: string | number | null | undefined): string {
  const n = typeof rate === "number" ? rate : Number(rate ?? 0);
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

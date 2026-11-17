/** Lowercase letters, digits, dots and hyphens. Empty input means "no username". */
export function normaliseUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase();
  if (!u) return null;
  if (u.length > 64 || !/^[a-z0-9]+(?:[.][a-z0-9]+|-[a-z0-9]+)*$/.test(u)) return null;
  return u;
}

export function normaliseEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(e)) return null;
  return e;
}

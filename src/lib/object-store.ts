/** Where file bytes live. Postgres is the default so a deploy without object storage keeps working. */
export type StorageDriverName = "postgres" | "s3";

export function storageDriver(): StorageDriverName {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "postgres";
}

/** Bytes the meter compares with. Unset on S3 means no percentage. Postgres defaults to the 1 GB free database. */
export function storageQuotaBytes(): number | null {
  const raw = Number(process.env.STORAGE_QUOTA_GB);
  if (Number.isFinite(raw) && raw > 0) return raw * 1024 * 1024 * 1024;
  if (storageDriver() === "postgres") return 1024 * 1024 * 1024;
  return null;
}

export function quotaWarning(usedBytes: number, quotaBytes: number | null): string | null {
  if (!quotaBytes || quotaBytes <= 0) return null;
  if (usedBytes < quotaBytes * 0.8) return null;
  const pct = Math.round((usedBytes / quotaBytes) * 100);
  return `Stored files are at ${pct}% of the storage quota.`;
}

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Inclusive byte range. Omit the range to read the whole object. */
  get(key: string, range?: { start: number; end: number }): Promise<Buffer | null>;
  head(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  totalBytes(): Promise<number>;
}

/** In-memory store used by tests and as the shape the S3 adapter must match. */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; type: string }>();
  async put(key: string, body: Buffer, type: string) { this.objects.set(key, { body: Buffer.from(body), type }); }
  async get(key: string, range?: { start: number; end: number }) {
    const hit = this.objects.get(key);
    if (!hit) return null;
    if (!range) return Buffer.from(hit.body);
    return Buffer.from(hit.body.subarray(range.start, range.end + 1));
  }
  async head(key: string) { return this.objects.get(key)?.body.length ?? null; }
  async delete(key: string) { this.objects.delete(key); }
  async totalBytes() {
    let n = 0;
    for (const item of this.objects.values()) n += item.body.length;
    return n;
  }
}

/**
 * Upload bytes, check the stored size and the first bytes, then clear the Postgres copy.
 * If the check fails the Postgres bytes are left in place.
 */
export async function copyVerified(store: ObjectStore, key: string, body: Buffer, contentType: string, clear: () => Promise<void>) {
  await store.put(key, body, contentType);
  const size = await store.head(key);
  if (size !== body.length) throw new Error(`Stored size for ${key} was ${size}, expected ${body.length}. Postgres copy kept.`);
  const sampleEnd = Math.min(body.length, 32) - 1;
  const sample = await store.get(key, { start: 0, end: sampleEnd });
  if (!sample || !sample.equals(body.subarray(0, sample.length))) throw new Error(`Stored bytes for ${key} did not match. Postgres copy kept.`);
  await clear();
}

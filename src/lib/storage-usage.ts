import "server-only";
import { q1 } from "./db";
import { quotaWarning, storageDriver, storageQuotaBytes } from "./object-store";
import { activeObjectStore } from "./storage-s3";

export async function storageUsage() {
  const driver = storageDriver();
  let bytes = 0;
  if (driver === "s3") {
    bytes = (await (await activeObjectStore())?.totalBytes()) ?? 0;
  } else {
    const row = await q1<{ n: string }>(
      `SELECT (
         coalesce((SELECT sum(octet_length(attachment_bytes)) FROM ops.hs_alerts), 0)
         + coalesce((SELECT sum(octet_length(pdf_bytes)) FROM ops.site_rams), 0)
         + coalesce((SELECT sum(octet_length(content)) FROM ops.attachments), 0)
         + coalesce((SELECT sum(octet_length(signature_png)) FROM ops.hs_acknowledgements), 0)
         + coalesce((SELECT sum(octet_length(signature_png)) FROM ops.rams_acknowledgements), 0)
       )::bigint::text AS n`);
    bytes = Number(row?.n ?? 0);
  }
  const quota = storageQuotaBytes();
  return { bytes, driver, quota, warning: quotaWarning(bytes, quota) };
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

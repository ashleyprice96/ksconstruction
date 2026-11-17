import "server-only";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { readStoredFile } from "./files";

export const TOP_SHEET_MAX_BYTES = 6 * 1024 * 1024;
export const TOP_SHEET_MAX_PAGES = 8;

const TOP_SHEET_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function checkTopSheet(file: File): string | null {
  if (!file || file.size === 0) return "Choose a page or a PDF.";
  if (file.size > TOP_SHEET_MAX_BYTES) return "Each top sheet page must be 6 MB or smaller.";
  if (!TOP_SHEET_TYPES.has(file.type)) return "Use a JPG, PNG or PDF.";
  return null;
}

export interface StoredFile { body: Buffer; mime: string; name: string }

function asBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value.replace(/^\\x/, ""), "hex");
  return null;
}

/**
 * A claim or issue file the user is allowed to open.
 * Gang leads only see their own gang. Office and approvers see every claim.
 * Anyone else, including another gang, gets nothing.
 */
export async function openAttachment(user: User, id: string): Promise<StoredFile | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await q1<{
    storage_key: string; mime: string; original_name: string; content: Buffer | null;
    claim_gang: string | null; issue_gang: string | null; issue_id: string | null;
  }>(
    `SELECT a.storage_key, a.mime, a.original_name, a.content, c.gang_id AS claim_gang, i.gang_id AS issue_gang, a.issue_id
     FROM ops.attachments a
     LEFT JOIN ops.claims c ON c.id = a.claim_id
     LEFT JOIN ops.issues i ON i.id = a.issue_id
     WHERE a.id = $1`,
    [id]);
  if (!row) return null;
  if (user.role === "gang") {
    const gang = row.issue_id ? row.issue_gang : row.claim_gang;
    if (!gang || gang !== user.gang_id) return null;
  } else if (user.role !== "contracts_manager" && user.role !== "management" && user.role !== "admin") {
    return null;
  }
  const stored = asBuffer(row.content);
  const body = stored ?? await readStoredFile(row.storage_key).catch(() => null);
  if (!body) return null;
  return { body, mime: row.mime, name: row.original_name };
}

export async function topSheetCount(claimId: string): Promise<number> {
  const row = await q1<{ n: number }>(
    "SELECT count(*)::int AS n FROM ops.attachments WHERE claim_id = $1 AND kind = 'top_sheet'", [claimId]);
  return row?.n ?? 0;
}

export async function listTopSheets(claimId: string) {
  return q<{ id: string; original_name: string; mime: string; uploaded_at: string }>(
    `SELECT id, original_name, mime, uploaded_at FROM ops.attachments
     WHERE claim_id = $1 AND kind = 'top_sheet' ORDER BY uploaded_at`,
    [claimId]);
}

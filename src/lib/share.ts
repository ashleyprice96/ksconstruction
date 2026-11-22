import "server-only";
import { randomBytes } from "node:crypto";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { sha256, signaturePng } from "./sign-off";
import { assertHsPdfSize, pdfPageCount } from "./hs-pdf";
import { saveFile, readStoredFile } from "./files";
import { storageDriver } from "./object-store";
import { isRemoteKey } from "./remote-file";

export class ShareError extends Error {}

export type ShareKind = "rams" | "toolbox" | "alert";

export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  rams: "RAMS",
  toolbox: "Toolbox talk",
  alert: "Safety alert",
};

export interface ShareItem {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  body: string;
  site_name: string | null;
  active: boolean;
  version: number;
  file_name: string | null;
  file_mime: string | null;
  file_bytes: Buffer | null;
  storage_key: string | null;
  content_sha256: string | null;
  pdf_pages: number | null;
}

const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);

function asBuffer(value: Buffer | null): Buffer | null {
  if (!value) return null;
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

export function shareNotifyTo(): string | null {
  const host = process.env.SMTP_HOST?.trim();
  const to = (process.env.SIGN_NOTIFY_EMAIL || process.env.RESET_REQUEST_EMAIL || "").trim();
  if (!host || !to) return null;
  return to;
}

export async function createShareItem(user: User, input: {
  kind: string; title: string; body: string; siteName: string;
  file: { name: string; type: string; bytes: Buffer; key: string | null } | null;
}): Promise<{ id: string; token: string; title: string }> {
  if (user.role !== "admin" && user.role !== "management") throw new ShareError("Only the office can send a document for signing.");
  const kind: ShareKind = input.kind === "toolbox" ? "toolbox" : input.kind === "alert" ? "alert" : input.kind === "rams" ? "rams" : "rams";
  if (!["rams", "toolbox", "alert"].includes(input.kind)) throw new ShareError("Choose RAMS, a toolbox talk, or a safety alert.");
  const title = input.title.trim();
  const body = input.body.trim();
  const site = input.siteName.trim();
  if (title.length < 3) throw new ShareError("Enter a title.");
  const file = input.file && input.file.bytes.length ? input.file : null;
  if (!file && kind !== "alert") throw new ShareError("Attach a PDF or a photo.");
  if (!file && body.length < 3) throw new ShareError("Attach a file, or write the alert.");
  let bytes: Buffer | null = null;
  let key: string | null = null;
  let mime: string | null = null;
  let name: string | null = null;
  let pages: number | null = null;
  let hashed = sha256(body || title);
  if (file) {
    mime = file.type || "application/octet-stream";
    if (mime === "application/pdf") {
      try { assertHsPdfSize(file.bytes.length); }
      catch (e) { throw new ShareError(e instanceof Error ? e.message : "The PDF is too large."); }
      pages = await pdfPageCount(file.bytes).catch(() => null);
    } else if (!IMAGE.has(mime) || file.bytes.length > 15 * 1024 * 1024) {
      throw new ShareError("Use a PDF, or a JPG, PNG or WebP under 15 MB.");
    }
    hashed = sha256(file.bytes);
    name = file.name.slice(0, 200);
    if (file.key) key = file.key;
    else if (storageDriver() === "postgres") bytes = file.bytes;
    else key = await saveFile(file.bytes, mime);
  }
  const token = randomBytes(32).toString("base64url");
  const row = await q1<{ id: string }>(
    `INSERT INTO ops.share_items
       (token, kind, title, body, site_name, file_name, file_mime, file_bytes, storage_key, content_sha256, pdf_pages, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [token, kind, title.slice(0, 200), body.slice(0, 10000), site ? site.slice(0, 200) : null, name, mime, bytes, key, hashed, pages, user.id]);
  return { id: row!.id, token, title: title.slice(0, 200) };
}

export async function setShareActive(user: User, id: string, active: boolean) {
  if (user.role !== "admin" && user.role !== "management") throw new ShareError("Only the office can change a signing link.");
  await q("UPDATE ops.share_items SET active = $2 WHERE id = $1", [id, active]);
}

export async function shareByToken(token: string): Promise<ShareItem | null> {
  if (!token || token.length < 20 || token.length > 80) return null;
  const row = await q1<ShareItem>(
    `SELECT id, token, kind, title, body, site_name, active, version, file_name, file_mime, file_bytes, storage_key, content_sha256, pdf_pages
     FROM ops.share_items WHERE token = $1`, [token]);
  if (!row) return null;
  return { ...row, file_bytes: asBuffer(row.file_bytes) };
}

export async function shareById(id: string): Promise<ShareItem | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await q1<ShareItem>(
    `SELECT id, token, kind, title, body, site_name, active, version, file_name, file_mime, file_bytes, storage_key, content_sha256, pdf_pages
     FROM ops.share_items WHERE id = $1`, [id]);
  if (!row) return null;
  return { ...row, file_bytes: asBuffer(row.file_bytes) };
}

export async function shareFileBytes(item: ShareItem): Promise<Buffer | null> {
  if (item.file_bytes?.length) return item.file_bytes;
  if (item.storage_key && isRemoteKey(item.storage_key)) return readStoredFile(item.storage_key).catch(() => null);
  return null;
}

export interface ShareSignature {
  id: string;
  full_name: string;
  company: string;
  signed_at: string;
  ip: string;
  user_agent: string;
  signature_png: Buffer | null;
  user_id: string | null;
}

export async function signaturesFor(itemId: string, version: number): Promise<ShareSignature[]> {
  const rows = await q<ShareSignature>(
    `SELECT id, full_name, company, signed_at, ip, user_agent, signature_png, user_id
     FROM ops.share_signatures WHERE item_id = $1 AND version = $2 ORDER BY signed_at`,
    [itemId, version]);
  return rows.map((row) => ({ ...row, signature_png: asBuffer(row.signature_png) }));
}

export async function signShare(input: {
  token: string; fullName: string; company: string; signatureDataUrl: string;
  ip: string; userAgent: string; userId: string | null;
}): Promise<{ item: ShareItem; name: string; company: string; png: Buffer }> {
  const item = await shareByToken(input.token);
  if (!item || !item.active) throw new ShareError("This link is switched off.");
  const name = input.fullName.trim().replace(/\s+/g, " ");
  const company = input.company.trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 3) throw new ShareError("Type your full name.");
  const png = signaturePng(input.signatureDataUrl);
  const recent = await q1<{ n: string }>(
    `SELECT count(*)::text AS n FROM ops.share_signatures WHERE ip = $1 AND signed_at > now() - interval '15 minutes'`,
    [(input.ip || "unknown").slice(0, 64)]);
  if (Number(recent?.n ?? 0) >= 20) throw new ShareError("Too many signatures from this connection. Wait a few minutes.");
  const dup = await q1(
    `SELECT 1 FROM ops.share_signatures
     WHERE item_id = $1 AND version = $2
       AND (($3::uuid IS NOT NULL AND user_id = $3::uuid)
            OR (lower(btrim(full_name)) = lower($4) AND lower(btrim(company)) = lower($5)))`,
    [item.id, item.version, input.userId, name, company]);
  if (dup) throw new ShareError("This name has already signed this document.");
  await q(
    `INSERT INTO ops.share_signatures (item_id, version, user_id, full_name, company, signature_png, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [item.id, item.version, input.userId, name.slice(0, 80), company, png, (input.ip || "unknown").slice(0, 64), (input.userAgent || "unknown").slice(0, 300)]);
  return { item, name: name.slice(0, 80), company, png };
}

export interface ShareCard {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  site_name: string | null;
  active: boolean;
  version: number;
  created_at: string;
  signers: number;
  people: { id: string; full_name: string; company: string; signed_at: string }[];
  missing: string | null;
}

export async function shareBoard(): Promise<ShareCard[]> {
  const items = await q<Omit<ShareCard, "people" | "missing">>(
    `SELECT i.id, i.token, i.kind, i.title, i.site_name, i.active, i.version, i.created_at,
            (SELECT count(*)::int FROM ops.share_signatures s WHERE s.item_id = i.id AND s.version = i.version) AS signers
     FROM ops.share_items i ORDER BY i.created_at DESC`);
  if (!items.length) return [];
  const people = await q<{ item_id: string; id: string; full_name: string; company: string; signed_at: string; version: number }>(
    `SELECT item_id, id, full_name, company, signed_at, version FROM ops.share_signatures
     WHERE item_id = ANY($1::uuid[]) ORDER BY signed_at`, [items.map((i) => i.id)]);
  const missing = await q<{ item_id: string; names: string | null }>(
    `SELECT i.id AS item_id, string_agg(u.name, ', ' ORDER BY u.name) AS names
     FROM ops.share_items i
     JOIN ops.users u ON u.active
     WHERE i.id = ANY($1::uuid[])
       AND NOT EXISTS (
         SELECT 1 FROM ops.share_signatures s
         WHERE s.item_id = i.id AND s.version = i.version AND s.user_id = u.id)
     GROUP BY i.id`, [items.map((i) => i.id)]);
  const missingBy = new Map(missing.map((row) => [row.item_id, row.names]));
  return items.map((item) => ({
    ...item,
    missing: missingBy.get(item.id) ?? null,
    people: people.filter((p) => p.item_id === item.id && p.version === item.version).map((p) => ({
      id: p.id, full_name: p.full_name, company: p.company, signed_at: p.signed_at,
    })),
  }));
}

export async function unsignedShares(userId: string) {
  return q<{ id: string; token: string; kind: ShareKind; title: string; site_name: string | null }>(
    `SELECT id, token, kind, title, site_name FROM ops.share_items i
     WHERE i.active AND NOT EXISTS (
       SELECT 1 FROM ops.share_signatures s WHERE s.item_id = i.id AND s.version = i.version AND s.user_id = $1)
     ORDER BY i.created_at DESC`, [userId]);
}

export async function userSigned(itemId: string, version: number, userId: string): Promise<boolean> {
  const row = await q1("SELECT 1 FROM ops.share_signatures WHERE item_id = $1 AND version = $2 AND user_id = $3", [itemId, version, userId]);
  return !!row;
}

export function shareCsv(cards: ShareCard[]): string {
  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["Type,Title,Site,Version,Name,Company,When"];
  for (const card of cards) {
    for (const person of card.people) {
      lines.push([
        SHARE_KIND_LABEL[card.kind], card.title, card.site_name ?? "", String(card.version),
        person.full_name, person.company, person.signed_at,
      ].map(esc).join(","));
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

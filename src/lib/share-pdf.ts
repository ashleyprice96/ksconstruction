import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { fmtDateTime } from "./dates";
import { SHARE_KIND_LABEL, shareFileBytes, signaturesFor, type ShareItem, type ShareSignature } from "./share";

const PAGE_W = 595;
const PAGE_H = 842;
const BATCH = 20;
const NAVY = rgb(0.07, 0.09, 0.16);
const ORANGE = rgb(0.91, 0.45, 0.17);
const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.33, 0.36, 0.42);

export interface SignedCopyInput {
  kindLabel: string;
  title: string;
  site: string | null;
  createdAt: string | Date;
  version: number;
  sha256: string | null;
  body: string;
  mime: string | null;
  bytes: Buffer | null;
  people: ShareSignature[];
}

/** Cover, then the whole document, then the signature register. The route checks the office login. */
export async function buildShareSignedCopy(item: ShareItem, signerId?: string): Promise<Uint8Array> {
  let people = await signaturesFor(item.id, item.version);
  if (signerId) {
    people = people.filter((person) => person.id === signerId);
    if (!people.length) throw new Error("Signer not found");
  }
  return renderSignedCopy({
    kindLabel: SHARE_KIND_LABEL[item.kind],
    title: item.title,
    site: item.site_name,
    createdAt: item.created_at,
    version: item.version,
    sha256: item.content_sha256,
    body: item.body,
    mime: item.file_mime,
    bytes: await shareFileBytes(item),
    people,
  });
}

export async function renderSignedCopy(input: SignedCopyInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const generated = fmtDateTime(new Date());
  await drawCover(doc, font, bold, input);
  const note = await attachDocument(doc, input);
  if (note) drawNotePage(doc, font, bold, note);
  if (input.body.trim() && !input.bytes?.length) drawTextPages(doc, font, bold, input.body);
  await drawRegister(doc, font, bold, input.people);
  stampFooters(doc, font, generated);
  return doc.save();
}

async function drawCover(doc: PDFDocument, font: PDFFont, bold: PDFFont, input: SignedCopyInput) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: PAGE_H - 108, width: PAGE_W, height: 108, color: NAVY });
  page.drawRectangle({ x: 0, y: PAGE_H - 114, width: PAGE_W, height: 6, color: ORANGE });
  try {
    const bytes = await readFile(join(process.cwd(), "public/ks-logo.png"));
    const logo = await doc.embedPng(bytes);
    page.drawImage(logo, { x: 48, y: PAGE_H - 84, width: 52, height: 52 });
  } catch { /* wordmark still shows */ }
  page.drawText("K-S Construction Group", { x: 116, y: PAGE_H - 52, size: 16, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Health and safety record", { x: 116, y: PAGE_H - 74, size: 11, font, color: ORANGE });

  let y = PAGE_H - 156;
  const line = (s: string, size = 11, f: PDFFont = font, color = INK) => {
    for (const row of wrap(s, size > 14 ? 36 : 78)) {
      page.drawText(row, { x: 48, y, size, font: f, color });
      y -= size + 7;
    }
  };
  line("Document type", 9, bold, MUTED);
  line(input.kindLabel, 16, bold);
  y -= 6;
  line("Title", 9, bold, MUTED);
  line(input.title, 14, bold);
  y -= 6;
  line("Site", 9, bold, MUTED);
  line(input.site?.trim() || "Not given");
  y -= 6;
  line("Link created", 9, bold, MUTED);
  line(fmtDateTime(input.createdAt));
  y -= 6;
  line("Document version", 9, bold, MUTED);
  line(String(input.version));
  y -= 6;
  line("SHA-256 of the attached file", 9, bold, MUTED);
  line(input.sha256 || "No file attached", 9);
  y -= 8;
  line("An auditor can match this hash to the file that was signed.", 10, font, MUTED);
}

async function attachDocument(doc: PDFDocument, input: SignedCopyInput): Promise<string | null> {
  if (!input.bytes?.length) return null;
  if (input.mime === "application/pdf") {
    try {
      const src = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
      const total = src.getPageCount();
      for (let start = 0; start < total; start += BATCH) {
        const index = Array.from({ length: Math.min(BATCH, total - start) }, (_, i) => start + i);
        const copied = await doc.copyPages(src, index);
        copied.forEach((sheet) => doc.addPage(sheet));
      }
      return null;
    } catch {
      return "The attached PDF could not be copied into this record. Match the original file to the SHA-256 on the cover.";
    }
  }
  if (input.mime === "image/png" || input.mime === "image/jpeg") {
    try {
      const img = input.mime === "image/png" ? await doc.embedPng(input.bytes) : await doc.embedJpg(input.bytes);
      const sheet = doc.addPage([PAGE_W, PAGE_H]);
      const scale = Math.min(500 / img.width, 700 / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      sheet.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
      return null;
    } catch {
      return "The attached photo could not be copied into this record. Match the original file to the SHA-256 on the cover.";
    }
  }
  return "This file type is stored with the link. Match it to the SHA-256 on the cover.";
}

function drawNotePage(doc: PDFDocument, font: PDFFont, bold: PDFFont, note: string) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText("Attached document", { x: 48, y: 780, size: 14, font: bold, color: INK });
  let y = 750;
  for (const row of wrap(note, 80)) {
    page.drawText(row, { x: 48, y, size: 11, font, color: INK });
    y -= 16;
  }
}

function drawTextPages(doc: PDFDocument, font: PDFFont, bold: PDFFont, body: string) {
  let page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText("Alert text", { x: 48, y: 780, size: 14, font: bold, color: INK });
  let y = 750;
  for (const row of wrap(body, 88)) {
    if (y < 64) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = 780;
    }
    page.drawText(row, { x: 48, y, size: 11, font, color: INK });
    y -= 16;
  }
}

async function drawRegister(doc: PDFDocument, font: PDFFont, bold: PDFFont, people: ShareSignature[]) {
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 780;
  const fresh = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = 780;
  };
  page.drawText("Signature register", { x: 48, y, size: 16, font: bold, color: INK });
  y -= 28;
  if (!people.length) {
    page.drawText("Nobody has signed yet.", { x: 48, y, size: 11, font, color: INK });
    return;
  }
  for (const person of people) {
    if (y < 160) fresh();
    page.drawRectangle({ x: 48, y: y - 6, width: 499, height: 1.2, color: ORANGE });
    y -= 22;
    page.drawText("Name", { x: 48, y, size: 8, font: bold, color: MUTED });
    page.drawText("Company / gang", { x: 220, y, size: 8, font: bold, color: MUTED });
    page.drawText("Date and time (UK)", { x: 400, y, size: 8, font: bold, color: MUTED });
    y -= 16;
    page.drawText(clip(person.full_name, 28), { x: 48, y, size: 11, font: bold, color: INK });
    page.drawText(clip(person.company.trim() || "Not given", 26), { x: 220, y, size: 10, font, color: INK });
    page.drawText(clip(fmtDateTime(person.signed_at), 22), { x: 400, y, size: 9, font, color: INK });
    y -= 12;
    if (person.signature_png && person.signature_png.length > 24) {
      try {
        const img = await doc.embedPng(person.signature_png);
        const w = 180;
        const h = Math.min(64, w * (img.height / img.width));
        if (y - h < 56) fresh();
        page.drawImage(img, { x: 48, y: y - h, width: w, height: h });
        y -= h + 22;
        continue;
      } catch { /* name row still shows */ }
    }
    y -= 18;
  }
}

function stampFooters(doc: PDFDocument, font: PDFFont, generated: string) {
  const pages = doc.getPages();
  const label = `K-S Construction Group Ltd, generated ${generated}`;
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height: 36, color: rgb(1, 1, 1) });
    page.drawText(label, { x: 40, y: 16, size: 8, font, color: MUTED });
    const num = `${index + 1} of ${pages.length}`;
    page.drawText(num, { x: width - 40 - font.widthOfTextAtSize(num, 8), y: 16, size: 8, font, color: MUTED });
  });
}

function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of value.split(/\n/)) {
    if (!para.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > width && line) {
        lines.push(line);
        line = word.slice(0, width);
      } else line = next.length > width ? next.slice(0, width) : next;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}.` : value;
}

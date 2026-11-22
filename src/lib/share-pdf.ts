import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fmtDateTime } from "./dates";
import { SHARE_KIND_LABEL, shareFileBytes, signaturesFor, type ShareItem } from "./share";

/** The shared document, then a sign-off sheet with each drawn signature. */
export async function buildShareSignedCopy(item: ShareItem): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.14);
  const bytes = await shareFileBytes(item);
  if (bytes && item.file_mime === "application/pdf") {
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copied = await doc.copyPages(src, src.getPageIndices());
      copied.forEach((page) => doc.addPage(page));
    } catch { /* the sign-off sheet still downloads */ }
  } else if (bytes && (item.file_mime === "image/png" || item.file_mime === "image/jpeg")) {
    const page = doc.addPage([595, 842]);
    try {
      const img = item.file_mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const w = Math.min(500, img.width);
      const h = w * (img.height / img.width);
      page.drawImage(img, { x: 48, y: Math.max(40, 780 - h), width: w, height: Math.min(h, 740) });
    } catch { /* image skipped */ }
  }

  const people = await signaturesFor(item.id, item.version);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const text = (s: string, x: number, size = 10, f = font) => {
    page.drawText(s.slice(0, 90), { x, y, size, font: f, color: ink });
  };
  const need = (n: number) => {
    if (y >= n) return;
    page = doc.addPage([595, 842]);
    y = 800;
  };
  text("Signed copy", 48, 11, bold);
  y -= 18;
  text(item.title, 48, 16, bold);
  y -= 22;
  text(`${SHARE_KIND_LABEL[item.kind]}${item.site_name ? ` · ${item.site_name}` : ""}`, 48, 10);
  y -= 16;
  if (!bytes && item.body) {
    for (const line of item.body.split(/\n/).slice(0, 40)) {
      need(30);
      text(line, 48, 10);
      y -= 14;
    }
    y -= 8;
  }
  need(40);
  text("Name", 48, 9, bold);
  text("Company / gang", 180, 9, bold);
  text("Signature", 340, 9, bold);
  text("When", 470, 9, bold);
  y -= 8;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.5, color: ink });
  y -= 18;
  if (!people.length) {
    text("Nobody has signed yet.", 48, 10);
  }
  for (const person of people) {
    need(80);
    const rowY = y;
    text(person.full_name, 48, 10);
    text(person.company || "—", 180, 9);
    text(fmtDateTime(person.signed_at), 470, 8);
    if (person.signature_png && person.signature_png.length > 24) {
      try {
        const img = await doc.embedPng(person.signature_png);
        const w = 90;
        const h = Math.min(36, w * (img.height / img.width));
        page.drawImage(img, { x: 340, y: rowY - 8, width: w, height: h });
        y -= h + 16;
        continue;
      } catch { /* name row still shows */ }
    }
    y -= 28;
  }
  return doc.save();
}

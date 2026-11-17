import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface SignedRow {
  name: string;
  at: string | null;
  ip: string | null;
  agent: string | null;
  typed: string | null;
  png: Buffer | null;
  attendees: string | null;
}

/** One PDF listing who signed a health and safety document, with the drawn signatures. */
export async function buildSignedRecord(input: {
  heading: string; title: string; revision: string; sha256: string | null; rows: SignedRow[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.14);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const text = (s: string, size = 10, f = font) => {
    page.drawText(s.slice(0, 110), { x: 48, y, size, font: f, color: ink });
    y -= size + 6;
  };
  const need = (n: number) => {
    if (y >= n) return;
    page = doc.addPage([595, 842]);
    y = 800;
  };
  text(input.heading, 11, bold);
  text(input.title, 16, bold);
  text(`Revision ${input.revision}`);
  text(`Content SHA-256 ${input.sha256 ?? "none"}`, 8);
  y -= 8;
  for (const row of input.rows) {
    need(160);
    text(row.name, 12, bold);
    text(`Signed ${row.at ?? "—"} · ${row.typed ?? "no typed name"}`);
    text(`IP ${row.ip ?? "—"}`, 8);
    text(`Agent ${(row.agent ?? "—").slice(0, 90)}`, 8);
    if (row.attendees) text(`Attendees: ${row.attendees}`, 9);
    if (row.png && row.png.length > 24) {
      try {
        const img = await doc.embedPng(row.png);
        const w = 180;
        const h = w * (img.height / img.width);
        need(h + 20);
        page.drawImage(img, { x: 48, y: y - h, width: w, height: h });
        y -= h + 12;
      } catch { text("Signature image could not be embedded."); }
    } else text("No drawn signature.");
    y -= 8;
  }
  if (!input.rows.length) text("Nobody has confirmed this document.");
  return doc.save();
}

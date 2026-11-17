import "server-only";
import { PDFDocument } from "pdf-lib";

/** App cap for an H&S, toolbox, or RAMS PDF. The database allows at most 50 MB. */
export function hsPdfMaxBytes(): number {
  const raw = Number(process.env.HS_PDF_MAX_MB ?? 50);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : 50;
  return Math.round(Math.min(mb, 50) * 1024 * 1024);
}

export function hsPdfMaxLabel(): string {
  return `${Math.round(hsPdfMaxBytes() / (1024 * 1024))} MB`;
}

export function assertHsPdfSize(size: number) {
  if (size > hsPdfMaxBytes()) {
    throw new Error(`The PDF must be ${hsPdfMaxLabel()} or smaller.`);
  }
}

export async function pdfPageCount(bytes: Buffer): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

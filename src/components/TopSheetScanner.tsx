"use client";

import { useRef, useState } from "react";

const MAX_BYTES = 6 * 1024 * 1024;

type Page = { name: string; url: string; file: File };

/**
 * Capture a paper top sheet. The phone camera uses the rear camera. Extra
 * shots are extra pages. JPG and PNG are cropped to the page and compressed
 * in the browser. No document is sent to an outside service.
 */
export default function TopSheetScanner({ action, claimId }: { action: (f: FormData) => void; claimId: string }) {
  const held = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [status, setStatus] = useState("");

  function remember(next: Page[]) {
    setPages(next);
    const input = held.current;
    if (!input) return;
    const dt = new DataTransfer();
    for (const page of next) dt.items.add(page.file);
    input.files = dt.files;
  }

  async function prepare(file: File): Promise<File> {
    const lower = file.name.toLowerCase();
    const pdf = file.type === "application/pdf" || lower.endsWith(".pdf");
    if (pdf) {
      if (file.size > MAX_BYTES) throw new Error("That PDF is larger than 6 MB.");
      return file.type === "application/pdf" ? file : new File([file], file.name, { type: "application/pdf" });
    }
    if (file.type && !file.type.startsWith("image/")) throw new Error("Use a JPG, PNG or PDF.");
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = Object.assign(window.document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    if (enhance) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 16) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
      const samples = Math.ceil(d.length / 16);
      let lo = 0, hi = 255, acc = 0;
      while (lo < 250 && (acc += hist[lo]) < samples * 0.02) lo++;
      acc = 0;
      while (hi > 5 && (acc += hist[hi]) < samples * 0.02) hi--;
      const range = Math.max(1, hi - lo);
      let minX = w, minY = h, maxX = 0, maxY = 0, dark = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const yv = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = Math.max(0, Math.min(255, ((yv - lo) * 255) / range));
          if (v < 232) {
            dark++;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      for (let i = 0; i < d.length; i += 4) {
        const yv = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, ((yv - lo) * 255) / range));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
      const bw = maxX - minX;
      const bh = maxY - minY;
      if (dark > 40 && bw > w * 0.35 && bh > h * 0.35 && (bw < w * 0.96 || bh < h * 0.96)) {
        const pad = 16;
        const x0 = Math.max(0, minX - pad);
        const y0 = Math.max(0, minY - pad);
        const cw = Math.min(w - x0, bw + pad * 2);
        const ch = Math.min(h - y0, bh + pad * 2);
        const cropped = ctx.getImageData(x0, y0, cw, ch);
        canvas.width = cw;
        canvas.height = ch;
        ctx.putImageData(cropped, 0, 0);
      }
    }
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("compress"))), "image/jpeg", 0.8));
    if (blob.size > MAX_BYTES) throw new Error("That photo is still larger than 6 MB. Move closer, or send a PDF.");
    const name = file.name.replace(/\.\w+$/, "") || "top-sheet";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  }

  async function add(list: File[]) {
    setStatus("Preparing...");
    const next = [...pages];
    const problems: string[] = [];
    for (const file of list) {
      try {
        const ready = await prepare(file);
        next.push({ name: ready.name, url: ready.type.startsWith("image/") ? URL.createObjectURL(ready) : "", file: ready });
      } catch (e) {
        problems.push(e instanceof Error ? e.message : "That file could not be prepared.");
      }
    }
    remember(next);
    setStatus(problems[0] || (next.length ? `${next.length} page${next.length === 1 ? "" : "s"} ready. Save the top sheet when you have them all.` : ""));
  }

  function drop(index: number) {
    const gone = pages[index];
    if (gone?.url) URL.revokeObjectURL(gone.url);
    remember(pages.filter((_, i) => i !== index));
  }

  return (
    <form action={action} className="stack" data-testid="top-sheet-scanner">
      <input type="hidden" name="claim_id" value={claimId} />
      <input ref={held} name="pages" type="file" className="sr-only" tabIndex={-1} multiple />
      <div className="row">
        <div className="file-field">
          <label htmlFor="top-sheet-camera">Scan a page</label>
          <div className="file-picker">
            <input id="top-sheet-camera" className="file-input" type="file" accept="image/*" capture="environment"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void add([f]); }} />
            <span className="file-picker-copy" aria-hidden="true">
              <strong>Use the camera</strong>
              <span>Rear camera. Take another photo for the next page.</span>
            </span>
          </div>
        </div>
        <div className="file-field">
          <label htmlFor="top-sheet-upload">Or upload a file</label>
          <div className="file-picker">
            <input id="top-sheet-upload" className="file-input" type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" multiple
              onChange={(e) => { const list = e.target.files ? Array.from(e.target.files) : []; e.target.value = ""; if (list.length) void add(list); }} />
            <span className="file-picker-copy" aria-hidden="true">
              <strong>PDF, JPG or PNG</strong>
              <span>Up to 8 pages, 6 MB each. Photos are compressed on this phone.</span>
            </span>
          </div>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
        <span>Straighten the page: crop to the paper and raise the contrast</span>
      </label>
      {pages.length > 0 && (
        <div className="thumbs">
          {pages.map((p, i) => (
            <figure key={`${p.name}-${i}`}>
              {p.url ? <img src={p.url} alt={`Top sheet page ${i + 1}`} /> : <div className="file-tile">PDF</div>}
              <figcaption>Page {i + 1}</figcaption>
              <button className="btn ghost small" type="button" onClick={() => drop(i)}>Remove</button>
            </figure>
          ))}
        </div>
      )}
      {status && <p className="file-status" aria-live="polite">{status}</p>}
      <button className="btn" type="submit" disabled={!pages.length}>Save top sheet</button>
    </form>
  );
}

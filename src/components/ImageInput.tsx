"use client";
import { useRef, useState } from "react";

/**
 * File input that shrinks photos on the phone before upload (faster on site signal,
 * keeps backup packs small) and can "enhance" document photos: greyscale plus a
 * contrast stretch so handwriting and drawings are easier to read. If anything
 * fails the original file is sent unchanged, so a capture is never lost.
 * This is not edge detection; proper document scanning comes with the native apps.
 */
export default function ImageInput({ name, label, hint, document = false, multiple = false, required = false }:
  { name: string; label: string; hint?: string; document?: boolean; multiple?: boolean; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [enhance, setEnhance] = useState(document);
  const [status, setStatus] = useState("");

  async function processFile(f: File): Promise<File> {
    if (!f.type.startsWith("image/") || f.type === "image/heic") return f;
    const bmp = await createImageBitmap(f);
    const max = 2000;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(window.document.createElement("canvas"), {
      width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale),
    });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (enhance) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      const hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
      const total = d.length / 4;
      let lo = 0, hi = 255, acc = 0;
      while (lo < 255 && (acc += hist[lo]) < total * 0.02) lo++;
      acc = 0;
      while (hi > 0 && (acc += hist[hi]) < total * 0.02) hi--;
      const range = Math.max(1, hi - lo);
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, ((y - lo) * 255) / range));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
    }
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.82));
    if (blob.size >= f.size && !enhance) return f;
    return new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }

  async function onChange() {
    const input = ref.current;
    if (!input?.files?.length) return;
    setStatus("Preparing...");
    try {
      const dt = new DataTransfer();
      for (const f of Array.from(input.files)) dt.items.add(await processFile(f).catch(() => f));
      input.files = dt.files;
      setStatus(`${dt.files.length} file${dt.files.length > 1 ? "s" : ""} ready to upload.`);
    } catch {
      setStatus("Ready to upload.");
    }
  }

  return (
    <div>
      <label htmlFor={name}>{label}{hint && <span className="hint">{hint}</span>}</label>
      <input ref={ref} id={name} name={name} type="file" accept={document ? "image/*,application/pdf" : "image/*"}
        multiple={multiple} required={required} onChange={onChange} />
      {document && (
        <label className="small" style={{ fontWeight: 400, marginTop: 6 }}>
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /> Enhance document (black and white, higher contrast)
        </label>
      )}
      {status && <p className="small muted" aria-live="polite">{status}</p>}
    </div>
  );
}

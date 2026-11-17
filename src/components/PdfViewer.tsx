"use client";

import { createContext, useContext, useState } from "react";

const Opened = createContext<{ needed: string[]; ready: boolean; mark: (id: string) => void } | null>(null);

/** Tracks which PDFs the gang lead has opened. The sign button stays off until each one is open. */
export function OpenedGate({ pdfIds, children }: { pdfIds: string[]; children: React.ReactNode }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ready = pdfIds.every((id) => open[id]);
  return <Opened.Provider value={{ needed: pdfIds, ready, mark: (id) => setOpen((s) => ({ ...s, [id]: true })) }}>{children}</Opened.Provider>;
}

export function SignButton({ children }: { children: string }) {
  const ctx = useContext(Opened);
  const ready = !ctx || ctx.needed.length === 0 || ctx.ready;
  return (
    <>
      <button className="btn" type="submit" disabled={!ready}>{children}</button>
      {!ready && <p className="small muted">Open the PDF before you sign.</p>}
    </>
  );
}

/** Inline PDF for a phone, with the page count and a way to open the whole file. */
export default function PdfViewer({ id, src, pages, title }: { id: string; src: string; pages: number | null; title: string }) {
  const ctx = useContext(Opened);
  const [opened, setOpened] = useState(false);
  function mark() {
    setOpened(true);
    ctx?.mark(id);
  }
  return (
    <div className="pdf-view" data-testid="pdf-viewer">
      <div className="pdf-tools">
        <p className="small" style={{ margin: 0 }}>{pages ? `${pages} pages` : "PDF"}</p>
        <a className="btn secondary small" href={src} target="_blank" rel="noreferrer" onClick={mark}>Open full PDF</a>
      </div>
      <iframe className="pdf-frame" title={title} src={src} onLoad={mark} />
      <input type="hidden" name={`opened_${id}`} value={opened ? "yes" : ""} />
    </div>
  );
}

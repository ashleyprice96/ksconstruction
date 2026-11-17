"use client";

import { useState } from "react";

/** Posts a Setup form and shows how much of the file has left the browser. */
export default function ProgressForm({ actionUrl, children, button }: { actionUrl: string; children: React.ReactNode; button: string }) {
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPct(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", actionUrl);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setPct(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let message = "Published.";
      try {
        const body = JSON.parse(xhr.responseText) as { ok?: boolean; error?: string; message?: string };
        if (xhr.status >= 400 || body.ok === false) {
          setError(body.error || "Upload failed.");
          setPct(null);
          return;
        }
        message = body.message || message;
      } catch { /* the response was not JSON */ }
      window.location.href = `/setup?s=safety&ok=${encodeURIComponent(message)}`;
    };
    xhr.onerror = () => { setError("Upload failed."); setPct(null); };
    xhr.send(new FormData(e.currentTarget));
  }

  return (
    <form onSubmit={onSubmit} className="card stack">
      {children}
      {pct !== null && (
        <div data-testid="upload-progress">
          <progress value={pct} max={100} style={{ width: "100%" }} />
          <p className="small muted" style={{ margin: "4px 0 0" }}>{pct}% uploaded</p>
        </div>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="btn" type="submit">{button}</button>
    </form>
  );
}

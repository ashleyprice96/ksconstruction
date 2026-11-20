"use client";

import { useState } from "react";
import { uploadPrivateBlob, type BlobPurpose } from "@/lib/blob-client";

/** Posts a Setup form and shows how much of the file has left the browser. */
export default function ProgressForm({ actionUrl, children, button, blobPurpose }: { actionUrl: string; children: React.ReactNode; button: string; blobPurpose?: BlobPurpose }) {
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPct(0);
    const form = e.currentTarget;
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
    const data = new FormData(form);
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (blobPurpose && file && file.size > 0) {
      try {
        const uploaded = await uploadPrivateBlob(file, blobPurpose, setPct);
        data.delete(fileInput!.name);
        data.set("blob_pathname", uploaded.pathname);
        data.set("blob_name", uploaded.name);
        data.set("blob_type", uploaded.contentType);
        data.set("blob_sha", uploaded.sha256);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setPct(null);
        return;
      }
    }
    xhr.send(data);
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

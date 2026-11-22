"use client";

import { useState } from "react";
import { uploadPrivateBlob } from "@/lib/blob-client";
import ShareLinkActions from "@/components/ShareLinkActions";

type LinkRow = { title: string; url: string; kind: string; site: string };

const KIND_LABEL: Record<string, string> = { rams: "RAMS", toolbox: "toolbox talk", alert: "safety alert" };

export default function ShareForm({ sites, useBlob }: { sites: string[]; useBlob: boolean }) {
  const [kind, setKind] = useState("rams");
  const [site, setSite] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [links, setLinks] = useState<LinkRow[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    try {
      if (useBlob && file && file.size > 0) {
        const uploaded = await uploadPrivateBlob(file, "share");
        data.delete("file");
        data.set("blob_pathname", uploaded.pathname);
        data.set("blob_name", uploaded.name);
        data.set("blob_type", uploaded.contentType);
        data.set("blob_sha", uploaded.sha256);
      }
      const res = await fetch("/api/share/upload", { method: "POST", body: data });
      const body = await res.json() as { ok?: boolean; error?: string; url?: string; title?: string };
      if (!res.ok || !body.ok || !body.url) {
        setError(body.error || "Could not create the link.");
        setPending(false);
        return;
      }
      setLinks((rows) => [{ title: body.title || "Document", url: body.url!, kind: KIND_LABEL[kind] || "document", site }, ...rows]);
      form.reset();
      setKind(String(data.get("kind") || "rams"));
      setSite(String(data.get("site_name") || ""));
      if (fileInput) fileInput.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link.");
    }
    setPending(false);
  }

  return (
    <div className="card stack" data-testid="share-form">
      <h2 style={{ marginTop: 0 }}>Send for signing</h2>
      <p className="small muted">Send a RAMS, toolbox talk or safety alert. The site stays filled in so the next one is quick. Anyone with the link can sign. No login.</p>
      <form onSubmit={onSubmit} className="stack">
        <div className="row">
          <div>
            <label htmlFor="share_kind">Type</label>
            <select id="share_kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="rams">RAMS</option>
              <option value="toolbox">Toolbox talk</option>
              <option value="alert">Safety alert</option>
            </select>
          </div>
          <div>
            <label htmlFor="share_site">Site (optional)</label>
            <input id="share_site" name="site_name" list="share_sites" value={site} onChange={(e) => setSite(e.target.value)} maxLength={200} placeholder="Type or pick a site" />
            <datalist id="share_sites">{sites.map((name) => <option key={name} value={name} />)}</datalist>
          </div>
        </div>
        <div><label htmlFor="share_title">Title</label><input id="share_title" name="title" type="text" required minLength={3} maxLength={200} /></div>
        {kind === "alert" && (
          <div><label htmlFor="share_body">Alert text (optional if you attach a file)</label><textarea id="share_body" name="body" maxLength={10000} /></div>
        )}
        <div><label htmlFor="share_file">PDF or photo</label><input id="share_file" name="file" type="file" accept={kind === "alert" ? "application/pdf,image/jpeg,image/png,image/webp" : "application/pdf,image/jpeg,image/png,image/webp"} /></div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="btn" type="submit" disabled={pending}>{pending ? "Creating link..." : "Create link"}</button>
      </form>
      {links.map((link) => (
        <div key={link.url} className="panel">
          <p style={{ marginTop: 0 }}><strong>{link.title}</strong></p>
          <p className="small" style={{ wordBreak: "break-all" }}>{link.url}</p>
          <ShareLinkActions kind={link.kind} title={link.title} site={link.site} url={link.url} />
        </div>
      ))}
    </div>
  );
}

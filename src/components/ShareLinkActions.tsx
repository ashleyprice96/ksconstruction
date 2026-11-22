"use client";

import { useState } from "react";

export function whatsAppHref(kind: string, title: string, site: string, url: string) {
  const place = site.trim() ? ` for ${site.trim()}` : "";
  const text = `Hello, please read and sign this ${kind}${place}: ${title}.\n${url}\nThank you, K-S Construction Group.`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export default function ShareLinkActions({ kind, title, site, url }: { kind: string; title: string; site: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="row">
      <button className="btn secondary small" type="button" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
      <a className="btn secondary small" href={whatsAppHref(kind, title, site, url)} target="_blank" rel="noreferrer">WhatsApp</a>
    </div>
  );
}

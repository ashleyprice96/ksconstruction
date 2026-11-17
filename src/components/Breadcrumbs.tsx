"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  claims: "Claims",
  new: "New claim",
  quantities: "Quantities",
  evidence: "Photos",
  sign: "Foreman signature",
  split: "Split and submit",
  payments: "Payments",
  mine: "My payments",
  backup: "Backup packs",
  rates: "Rates",
  issues: "Issues",
  notices: "Notices",
  setup: "Setup",
  commercial: "Margin",
};

export default function Breadcrumbs() {
  const path = usePathname() || "/";
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ href: "/", label: "Dashboard" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ href: acc, label: LABELS[part] ?? (part.length > 16 ? "Details" : part) });
  }
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={c.href}>
            {i < crumbs.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { applyFilters } from "./tableFilters";

export function SelectAll({ tableId }: { tableId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all visible rows"
      onChange={(e) => {
        const on = e.currentTarget.checked;
        document.getElementById(tableId)?.querySelectorAll<HTMLInputElement>("tbody tr:not([hidden]) input.row-check").forEach((box) => {
          box.checked = on;
        });
      }}
    />
  );
}

/** Filter controls for a list. Status can keep the existing query-string behaviour, or filter the rows already on the page. */
export default function ListToolbar({
  tableId,
  statusNavigate,
  statusClient = false,
  statuses = [],
  gangs = [],
  sites = [],
  showDate = true,
  showGang = true,
  showSite = false,
  newClaim = false,
}: {
  tableId: string;
  statusNavigate?: { base: string; param?: string; value: string; options: { value: string; label: string }[] };
  statusClient?: boolean;
  statuses?: { value: string; label: string }[];
  gangs?: string[];
  sites?: string[];
  showDate?: boolean;
  showGang?: boolean;
  showSite?: boolean;
  newClaim?: boolean;
}) {
  const router = useRouter();

  function facet(name: "filterDate" | "filterGang" | "filterSite" | "filterStatus", value: string) {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;
    table.dataset[name] = value;
    applyFilters(table);
  }

  return (
    <div className="toolbar">
      <div className="toolbar-filters">
        {showDate && (
          <label>
            Date
            <select defaultValue="all" onChange={(e) => facet("filterDate", e.target.value)}>
              <option value="all">All dates</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="older">Older</option>
            </select>
          </label>
        )}
        {statusNavigate && (
          <label>
            Status
            <select
              value={statusNavigate.value}
              onChange={(e) => {
                const v = e.target.value;
                const param = statusNavigate.param ?? "status";
                router.push(v ? `${statusNavigate.base}?${param}=${encodeURIComponent(v)}` : statusNavigate.base);
              }}
            >
              {statusNavigate.options.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        {statusClient && (
          <label>
            Status
            <select defaultValue="all" onChange={(e) => facet("filterStatus", e.target.value)}>
              <option value="all">All statuses</option>
              {statuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        {showGang && gangs.length > 0 && (
          <label>
            Gang
            <select defaultValue="all" onChange={(e) => facet("filterGang", e.target.value)}>
              <option value="all">All gangs</option>
              {gangs.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        )}
        {showSite && sites.length > 0 && (
          <label>
            Site
            <select defaultValue="all" onChange={(e) => facet("filterSite", e.target.value)}>
              <option value="all">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
      {newClaim && <Link className="btn" href="/claims/new">+ New claim</Link>}
    </div>
  );
}

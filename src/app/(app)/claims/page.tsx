import Link from "next/link";
import { requireUser, isManager } from "@/lib/auth";
import { q } from "@/lib/db";
import { gbp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/lookups";
import { currentWeek } from "@/lib/settings";
import Flash from "@/components/Flash";
import ListToolbar, { SelectAll } from "@/components/ListToolbar";

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mgr = isManager(user);
  const status = sp.status && STATUS_LABEL[sp.status] ? sp.status : null;
  const params: unknown[] = [];
  const where: string[] = [];
  where.push("c.deleted_at IS NULL");
  if (user.role === "gang") { params.push(user.gang_id); where.push(`c.gang_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
  const { today, weekStart, weekEnding } = await currentWeek();
  const rows = await q<{ id: string; ref: string; gang: string; site: string; job: string; plot: string | null; claim_type: string;
    status: string; week_ending: string | null; work_date: string; flags: string; value: string | null }>(
    `SELECT c.id, c.ref, g.name AS gang, s.name AS site, j.code AS job, p.plot_number AS plot, c.claim_type, c.status,
       to_char(c.week_ending, 'YYYY-MM-DD') AS week_ending, to_char(c.work_date, 'YYYY-MM-DD') AS work_date,
       (SELECT count(*) FROM ops.claim_flags f WHERE f.claim_id = c.id) AS flags,
       (SELECT sum(gang_value) FROM ops.claim_lines l WHERE l.claim_id = c.id) AS value
     FROM ops.claims c JOIN ops.gangs g ON g.id = c.gang_id JOIN ops.sites s ON s.id = c.site_id
     JOIN ops.job_numbers j ON j.id = c.job_number_id LEFT JOIN ops.plots p ON p.id = c.plot_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY c.created_at DESC LIMIT 300`, params);
  const cols = 7 + (user.role !== "gang" ? 1 : 0) + (mgr ? 1 : 0);
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Claims</div><h1>{user.role === "gang" ? "Your claims" : "All claims"}</h1></div>
      </div>
      <Flash sp={sp} />
      <section className="panel">
        <ListToolbar
          tableId="claims-table"
          showGang={user.role !== "gang"}
          showSite
          gangs={[...new Set(rows.map((r) => r.gang))].sort((a, b) => a.localeCompare(b, "en-GB"))}
          sites={[...new Set(rows.map((r) => r.site))].sort((a, b) => a.localeCompare(b, "en-GB"))}
          newClaim
          statusNavigate={{
            base: "/claims",
            value: status ?? "",
            options: [{ value: "", label: "All statuses" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))],
          }}
        />
        <div className="table-wrap dense">
          <table id="claims-table" data-today={today} data-week-start={weekStart} data-week-end={weekEnding}>
            <thead><tr>
              <th className="check"><SelectAll tableId="claims-table" /></th>
              <th>Claim</th>{user.role !== "gang" && <th>Gang</th>}<th>Site / job / plot</th><th>Type</th><th>Week ending</th><th>Status</th>
              {mgr && <th className="num">Gang value</th>}
              <th className="actions"> </th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr data-empty="1"><td colSpan={cols} className="muted">No claims yet.</td></tr>}
              <tr data-filter-empty="1" hidden><td colSpan={cols} className="muted">No claims match these filters.</td></tr>
              {rows.map((r) => (
                <tr key={r.id} data-status={r.status} data-gang={r.gang} data-site={r.site} data-date={r.week_ending ?? r.work_date}>
                  <td className="check"><input className="row-check" type="checkbox" aria-label={`Select ${r.ref}`} /></td>
                  <td><Link href={`/claims/${r.id}`}>{r.ref}</Link></td>
                  {user.role !== "gang" && <td>{r.gang}</td>}
                  <td>{r.site}<br /><span className="muted small">{r.job}{r.plot ? ` · Plot ${r.plot}` : ""}</span></td>
                  <td>{TYPE_LABEL[r.claim_type]}</td>
                  <td>{r.week_ending ? fmtDate(r.week_ending) : <span className="muted small">Work {fmtDate(r.work_date)}</span>}</td>
                  <td><span className={`badge ${r.status}${r.status === "awaiting_management" ? " submitted" : ""}`}>{STATUS_LABEL[r.status]}</span>{mgr && Number(r.flags) > 0 && <> <span className="badge flag flagged">{r.flags} flag{Number(r.flags) > 1 ? "s" : ""}</span></>}</td>
                  {mgr && <td className="num">{r.value ? gbp(r.value) : ""}</td>}
                  <td className="actions"><Link className="btn ghost small" href={`/claims/${r.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

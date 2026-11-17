import Link from "next/link";
import { requireUser, isManager } from "@/lib/auth";
import { q } from "@/lib/db";
import { gbp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/lookups";
import Flash from "@/components/Flash";

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mgr = isManager(user);
  const status = sp.status && STATUS_LABEL[sp.status] ? sp.status : null;
  const params: unknown[] = [];
  const where: string[] = [];
  if (user.role === "gang") { params.push(user.gang_id); where.push(`c.gang_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
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
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Claims</div><h1>{user.role === "gang" ? "Your claims" : "All claims"}</h1></div>
        <div className="actions">{user.role === "gang" && <Link className="btn" href="/claims/new">New claim</Link>}</div>
      </div>
      <Flash sp={sp} />
      <p className="small">
        Filter: <Link href="/claims">All</Link>
        {Object.entries(STATUS_LABEL).map(([k, v]) => <span key={k}> · <Link href={`/claims?status=${k}`}>{v}</Link></span>)}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Claim</th>{user.role !== "gang" && <th>Gang</th>}<th>Site / job / plot</th><th>Type</th><th>Week ending</th><th>Status</th>
            {mgr && <th className="num">Gang value</th>}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No claims yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/claims/${r.id}`}>{r.ref}</Link></td>
                {user.role !== "gang" && <td>{r.gang}</td>}
                <td>{r.site}<br /><span className="muted small">{r.job}{r.plot ? ` · Plot ${r.plot}` : ""}</span></td>
                <td>{TYPE_LABEL[r.claim_type]}</td>
                <td>{r.week_ending ? fmtDate(r.week_ending) : <span className="muted small">Work {fmtDate(r.work_date)}</span>}</td>
                <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>{mgr && Number(r.flags) > 0 && <> <span className="badge flag">{r.flags} flag{Number(r.flags) > 1 ? "s" : ""}</span></>}</td>
                {mgr && <td className="num">{r.value ? gbp(r.value) : ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

import Link from "next/link";
import { requireUser, isManager } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { addDays, fmtDate, weekEndingFor } from "@/lib/dates";
import { settings } from "@/lib/settings";
import { gbp } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/lookups";
import Flash from "@/components/Flash";
import AreaChart from "@/components/AreaChart";
import ListToolbar, { SelectAll } from "@/components/ListToolbar";
import { claimsEnabled } from "@/lib/features";
import HsHome from "./hs-home";

function longDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London",
  });
}
function shortWeek(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

function seriesWeeks(end: string, count: number, values: Map<string, number>) {
  const points: { label: string; value: number; week: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const week = addDays(end, -7 * i);
    points.push({ week, label: shortWeek(week), value: values.get(week) ?? 0 });
  }
  return points;
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (!claimsEnabled()) return <HsHome searchParams={searchParams} />;
  const user = await requireUser();
  const sp = await searchParams;
  const mgr = isManager(user);
  const office = user.role !== "gang";
  const cutoff = await settings.cutoff();
  const weekEnding = weekEndingFor(new Date(), cutoff);
  const weekStart = addDays(weekEnding, -6);
  const today = new Date().toISOString().slice(0, 10);
  const countParams: unknown[] = [weekEnding, weekStart];
  const recentParams: unknown[] = [];
  let countGang = "";
  let recentGang = "";
  let issueGang = "";
  const issueParams: unknown[] = [];
  if (user.role === "gang") {
    countParams.push(user.gang_id);
    countGang = `AND c.gang_id = $${countParams.length}`;
    recentParams.push(user.gang_id);
    recentGang = `AND c.gang_id = $${recentParams.length}`;
    issueParams.push(user.gang_id);
    issueGang = `AND gang_id = $${issueParams.length}`;
  }
  const counts = await q1<{ drafts: string; awaiting: string; returned: string; flagged: string; this_week: string }>(
    `SELECT count(*) FILTER (WHERE status = 'draft') AS drafts,
            count(*) FILTER (WHERE status = 'awaiting_management') AS awaiting,
            count(*) FILTER (WHERE status = 'returned') AS returned,
            count(*) FILTER (WHERE status = 'awaiting_management' AND EXISTS (SELECT 1 FROM ops.claim_flags f WHERE f.claim_id = c.id)) AS flagged,
            count(*) FILTER (WHERE c.week_ending = $1::date OR (c.week_ending IS NULL AND c.work_date BETWEEN $2::date AND $1::date)) AS this_week
     FROM ops.claims c WHERE c.deleted_at IS NULL ${countGang}`, countParams);
  const issues = await q1<{ open: string; safety: string }>(
    `SELECT count(*) FILTER (WHERE status <> 'closed' AND kind = 'snag') AS open, count(*) FILTER (WHERE status <> 'closed' AND kind = 'safety') AS safety
     FROM ops.issues WHERE true ${issueGang}`, issueParams);
  const nextRun = await q1<{ id: string; payment_date: string; payless_closes_at: string }>(
    "SELECT id, to_char(payment_date, 'YYYY-MM-DD') AS payment_date, payless_closes_at FROM ops.pay_runs WHERE status = 'open' ORDER BY payment_date LIMIT 1");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const recent = await q<{ id: string; ref: string; gang: string; site: string; job: string; plot: string | null; status: string; when: string; flags: string; value: string | null }>(
    `SELECT c.id, c.ref, g.name AS gang, s.name AS site, j.code AS job, p.plot_number AS plot, c.status,
       to_char(COALESCE(c.week_ending, c.work_date), 'YYYY-MM-DD') AS when,
       (SELECT count(*) FROM ops.claim_flags f WHERE f.claim_id = c.id) AS flags,
       (SELECT sum(gang_value) FROM ops.claim_lines l WHERE l.claim_id = c.id) AS value
     FROM ops.claims c JOIN ops.gangs g ON g.id = c.gang_id JOIN ops.sites s ON s.id = c.site_id
     JOIN ops.job_numbers j ON j.id = c.job_number_id LEFT JOIN ops.plots p ON p.id = c.plot_id
     WHERE c.deleted_at IS NULL ${recentGang}
     ORDER BY c.created_at DESC LIMIT 8`, recentParams);

  let heroMoney = false;
  let heroValue = 0;
  let points: { label: string; value: number }[] = [];
  if (office) {
    const from = addDays(weekEnding, -7 * 11);
    if (mgr) {
      heroMoney = true;
      if (nextRun) {
        const total = await q1<{ total: string }>(
          `SELECT coalesce(sum(l.gang_value), 0)::text AS total
           FROM ops.claims c LEFT JOIN ops.claim_lines l ON l.claim_id = c.id
           WHERE c.pay_run_id = $1 AND c.deleted_at IS NULL AND c.status IN ('awaiting_management', 'approved', 'paid')`, [nextRun.id]);
        heroValue = Number(total?.total ?? 0);
      }
      const rows = await q<{ week: string; total: string }>(
        `SELECT to_char(c.week_ending, 'YYYY-MM-DD') AS week, coalesce(sum(l.gang_value), 0)::text AS total
         FROM ops.claims c LEFT JOIN ops.claim_lines l ON l.claim_id = c.id
         WHERE c.week_ending BETWEEN $1::date AND $2::date AND c.deleted_at IS NULL AND c.status <> 'draft'
         GROUP BY c.week_ending`, [from, weekEnding]);
      points = seriesWeeks(weekEnding, 12, new Map(rows.map((r) => [r.week, Number(r.total)])));
    } else {
      if (nextRun) {
        const total = await q1<{ n: string }>(
          `SELECT count(*)::text AS n FROM ops.claims
           WHERE pay_run_id = $1 AND deleted_at IS NULL AND status IN ('awaiting_management', 'approved', 'paid')`, [nextRun.id]);
        heroValue = Number(total?.n ?? 0);
      }
      const rows = await q<{ week: string; n: string }>(
        `SELECT to_char(week_ending, 'YYYY-MM-DD') AS week, count(*)::text AS n
         FROM ops.claims WHERE deleted_at IS NULL AND week_ending BETWEEN $1::date AND $2::date AND status <> 'draft'
         GROUP BY week_ending`, [from, weekEnding]);
      points = seriesWeeks(weekEnding, 12, new Map(rows.map((r) => [r.week, Number(r.n)])));
    }
  }

  const recentCols = 6 + (office ? 1 : 0) + (mgr ? 1 : 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{office ? "Office" : "K-S Claims"}</div>
          <h1>{office ? "Dashboard" : `Hello, ${user.name.split(" ")[0]}`}</h1>
          <p className="small muted">Claims submitted now count towards week ending <strong>{fmtDate(weekEnding)}</strong>. Cut-off: {days[cutoff.weekday]} {cutoff.time}.</p>
        </div>
        <div className="actions">{user.role === "gang" && <Link className="btn" href="/claims/new">+ New claim</Link>}</div>
      </div>
      <Flash sp={sp} />

      {office ? (
        <>
          <div className="kpi-strip">
            <Link href="/claims?status=awaiting_management" className="stat"><div className="l">Awaiting sign-off</div><div className="n">{counts?.awaiting ?? 0}</div></Link>
            <Link href="/claims?status=awaiting_management" className="stat"><div className="l">Flagged</div><div className="n">{counts?.flagged ?? 0}</div></Link>
            <Link href="/claims" className="stat"><div className="l">This week&apos;s claims</div><div className="n">{counts?.this_week ?? 0}</div></Link>
          </div>
          <div className="office-grid">
            <article className="pay-hero">
              <p className="hero-kicker">Next pay run</p>
              <h2>{nextRun ? longDate(nextRun.payment_date) : "No open pay run"}</h2>
              <p className="hero-amount">{heroMoney ? gbp(heroValue) : heroValue}</p>
              <p className="hero-note">{heroMoney ? "Gang value of claims on this run" : "Claims on this run"}{mgr && nextRun ? `. Pay-less window closes ${fmtDate(nextRun.payless_closes_at)}` : ""}</p>
              <AreaChart points={points} caption={heroMoney ? "Weekly gang-value totals" : "Weekly claim counts"} />
            </article>
            <section className="panel">
              <div className="panel-head"><h2>Recent claims</h2></div>
              <ListToolbar
                tableId="recent-claims"
                statusClient
                statuses={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                gangs={[...new Set(recent.map((r) => r.gang))].sort((a, b) => a.localeCompare(b, "en-GB"))}
                showSite={false}
                newClaim
              />
              <RecentTable id="recent-claims" rows={recent} office={office} mgr={mgr} cols={recentCols} today={today} weekStart={weekStart} weekEnding={weekEnding} />
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="kpi-strip">
            <Link href="/claims?status=draft" className="stat"><div className="l">Drafts to finish</div><div className="n">{counts?.drafts ?? 0}</div></Link>
            <Link href="/claims?status=returned" className="stat"><div className="l">Returned</div><div className="n">{counts?.returned ?? 0}</div></Link>
            <Link href="/claims?status=awaiting_management" className="stat"><div className="l">Waiting for sign-off</div><div className="n">{counts?.awaiting ?? 0}</div></Link>
          </div>
          {nextRun && (
            <div className="stat stat-when" style={{ marginBottom: 16 }}><div className="n">{fmtDate(nextRun.payment_date)}</div>
              <div className="l">Next payment run</div></div>
          )}
          <section className="panel">
            <div className="panel-head"><h2>Your claims</h2></div>
            <ListToolbar tableId="recent-claims" statusClient statuses={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} showGang={false} newClaim />
            <RecentTable id="recent-claims" rows={recent} office={false} mgr={false} cols={recentCols} today={today} weekStart={weekStart} weekEnding={weekEnding} />
          </section>
          <p className="small muted">Open snags: {issues?.open ?? 0}{Number(issues?.safety) > 0 ? ` · Safety issues: ${issues?.safety}` : ""}</p>
        </>
      )}
    </>
  );
}

function RecentTable({ id, rows, office, mgr, cols, today, weekStart, weekEnding }: {
  id: string; rows: { id: string; ref: string; gang: string; site: string; job: string; plot: string | null; status: string; when: string; flags: string; value: string | null }[];
  office: boolean; mgr: boolean; cols: number; today: string; weekStart: string; weekEnding: string;
}) {
  return (
    <div className="table-wrap dense">
      <table id={id} data-today={today} data-week-start={weekStart} data-week-end={weekEnding}>
        <thead><tr>
          <th className="check"><SelectAll tableId={id} /></th>
          <th>Claim</th>
          {office && <th>Gang</th>}
          <th>Site</th>
          <th>Date</th>
          <th>Status</th>
          {mgr && <th className="num">Amount</th>}
          <th className="actions"> </th>
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr data-empty="1"><td colSpan={cols} className="muted">No claims yet.</td></tr>}
          <tr data-filter-empty="1" hidden><td colSpan={cols} className="muted">No claims match these filters.</td></tr>
          {rows.map((r) => (
            <tr key={r.id} data-date={r.when} data-status={r.status} data-gang={r.gang} data-site={r.site}>
              <td className="check"><input className="row-check" type="checkbox" aria-label={`Select ${r.ref}`} /></td>
              <td><Link href={`/claims/${r.id}`}>{r.ref}</Link></td>
              {office && <td>{r.gang}</td>}
              <td>{r.site}<div className="muted small">{r.job}{r.plot ? ` · Plot ${r.plot}` : ""}</div></td>
              <td>{fmtDate(r.when)}</td>
              <td>
                <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                {mgr && Number(r.flags) > 0 && <> <span className="badge flagged">{r.flags} flag{Number(r.flags) > 1 ? "s" : ""}</span></>}
              </td>
              {mgr && <td className="num">{r.value ? gbp(r.value) : ""}</td>}
              <td className="actions"><Link className="btn ghost small" href={`/claims/${r.id}`}>View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { requireUser, isManager } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { fmtDate, weekEndingFor } from "@/lib/dates";
import { settings } from "@/lib/settings";
import Flash from "@/components/Flash";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mgr = isManager(user);
  const gangFilter = user.role === "gang" ? "AND gang_id = $1" : "";
  const gp = user.role === "gang" ? [user.gang_id] : [];
  const counts = await q1<{ drafts: string; awaiting: string; returned: string; flagged: string }>(
    `SELECT count(*) FILTER (WHERE status = 'draft') AS drafts,
            count(*) FILTER (WHERE status = 'awaiting_management') AS awaiting,
            count(*) FILTER (WHERE status = 'returned') AS returned,
            count(*) FILTER (WHERE status = 'awaiting_management' AND EXISTS (SELECT 1 FROM ops.claim_flags f WHERE f.claim_id = c.id)) AS flagged
     FROM ops.claims c WHERE true ${gangFilter}`, gp);
  const issues = await q1<{ open: string; safety: string }>(
    `SELECT count(*) FILTER (WHERE status <> 'closed' AND kind = 'snag') AS open, count(*) FILTER (WHERE status <> 'closed' AND kind = 'safety') AS safety
     FROM ops.issues WHERE true ${gangFilter}`, gp);
  const nextRun = await q1<{ payment_date: string; payless_closes_at: string }>(
    "SELECT to_char(payment_date, 'YYYY-MM-DD') AS payment_date, payless_closes_at FROM ops.pay_runs WHERE status = 'open' ORDER BY payment_date LIMIT 1");
  const cutoff = await settings.cutoff();
  const weekEnding = weekEndingFor(new Date(), cutoff);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">K-S Claims</div><h1>Hello, {user.name.split(" ")[0]}</h1></div>
        <div className="actions">{user.role === "gang" && <Link className="btn" href="/claims/new">New claim</Link>}</div>
      </div>
      <Flash sp={sp} />
      <p className="small muted">Claims submitted now count towards week ending <strong>{fmtDate(weekEnding)}</strong>. Cut-off: {days[cutoff.weekday]} {cutoff.time}.</p>
      <div className="grid">
        {user.role === "gang" && <>
          <Link href="/claims?status=draft" className="stat" style={{ textDecoration: "none" }}><div className="n">{counts?.drafts}</div><div className="l">Drafts to finish</div></Link>
          <Link href="/claims?status=returned" className="stat" style={{ textDecoration: "none" }}><div className="n">{counts?.returned}</div><div className="l">Returned for correction</div></Link>
          <Link href="/claims?status=awaiting_management" className="stat" style={{ textDecoration: "none" }}><div className="n">{counts?.awaiting}</div><div className="l">Waiting for K-S sign-off</div></Link>
        </>}
        {user.role !== "gang" && <>
          <Link href="/claims?status=awaiting_management" className="stat" style={{ textDecoration: "none" }}><div className="n">{counts?.awaiting}</div><div className="l">Awaiting sign-off</div></Link>
          {mgr && <Link href="/claims?status=awaiting_management" className="stat" style={{ textDecoration: "none" }}><div className="n">{counts?.flagged}</div><div className="l">Flagged for checking</div></Link>}
        </>}
        <Link href="/issues" className="stat" style={{ textDecoration: "none" }}><div className="n">{issues?.open}</div><div className="l">Open snags</div></Link>
        {nextRun && (
          <div className="stat"><div className="n" style={{ fontSize: "1.2rem" }}>{fmtDate(nextRun.payment_date)}</div>
            <div className="l">Next payment run{mgr ? `. Pay-less window closes ${fmtDate(nextRun.payless_closes_at)}` : ""}</div></div>
        )}
      </div>
    </>
  );
}

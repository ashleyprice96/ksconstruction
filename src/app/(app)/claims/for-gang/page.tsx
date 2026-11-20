import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createOfficeDraft, ClaimError, type ClaimType } from "@/lib/claims";
import { jobOptions, plotOptions } from "@/lib/lookups";
import { gangLiftCard, gangRateCard } from "@/lib/rates";
import { back, safeMessage, str } from "@/lib/forms";
import { isoDate } from "@/lib/dates";
import { q } from "@/lib/db";
import Flash from "@/components/Flash";
import NewClaimForm from "@/components/NewClaimForm";

async function create(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const job = (await jobOptions()).find((j) => j.id === str(f, "job"));
  let id: string;
  try {
    id = await createOfficeDraft(user, str(f, "gang_user"), {
      siteId: str(f, "site") || job?.site_id || "", jobNumberId: str(f, "job"), plotId: str(f, "plot") || null,
      claimType: str(f, "type") as ClaimType, workDate: str(f, "work_date"), stage: str(f, "stage"),
    });
  } catch (e) {
    back(`/claims/for-gang?gang=${encodeURIComponent(str(f, "gang_user"))}`, "error", safeMessage(e, [ClaimError]));
  }
  redirect(`/claims/${id}/quantities`);
}

export default async function EnterForGang({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["management", "admin"]);
  const sp = await searchParams;
  const today = isoDate(new Date());
  const leads = await q<{ id: string; name: string; gang: string; gang_id: string }>(
    `SELECT u.id, u.name, g.name AS gang, u.gang_id FROM ops.users u
     JOIN ops.gangs g ON g.id = u.gang_id WHERE u.role = 'gang' AND u.active ORDER BY g.name, u.name`);
  const gangUser = leads.find((l) => l.id === sp.gang) ?? null;
  const [jobs, plots, sites, itemRates, liftRates, missing] = await Promise.all([
    jobOptions(),
    plotOptions(),
    q<{ id: string; name: string; region: string; client: string | null }>(
      `SELECT s.id, s.name, s.region, c.name AS client FROM ops.sites s
       LEFT JOIN ops.clients c ON c.id = s.client_id WHERE s.active ORDER BY s.name`),
    gangUser ? gangRateCard(gangUser.gang_id, today) : Promise.resolve([]),
    gangLiftCard(today),
    gangUser ? q<{ site_id: string; title: string; revision: string }>(
      `SELECT r.site_id, r.title, r.revision FROM ops.site_rams r
       WHERE r.active AND NOT EXISTS (
         SELECT 1 FROM ops.rams_acknowledgements k WHERE k.rams_id = r.id AND k.user_id = $1)`,
      [gangUser.id]) : Promise.resolve([]),
  ]);
  const warnings: Record<string, string> = {};
  for (const row of missing) {
    const line = `${row.title} (revision ${row.revision})`;
    warnings[row.site_id] = warnings[row.site_id]
      ? `${warnings[row.site_id]} ${line}`
      : `${gangUser!.name} has not signed the current RAMS for this site: ${line}. You can still enter the claim. They will be asked to sign it the next time they log in.`;
  }
  const rates = [
    ...itemRates.map((r) => ({ siteId: r.site_id, name: r.name, unit: r.unit, rate: r.rate, source: r.source })),
    ...(gangUser ? liftRates : []).map((r) => ({ siteId: r.site_id, name: `${r.house_type}: ${r.name}`, unit: "lift", rate: r.value, source: r.source })),
  ];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Office</div><h1>Enter a claim for a gang</h1></div></div>
      <Flash sp={sp} />
      <form className="card stack" method="get">
        <div><label htmlFor="gang">Gang lead</label>
          <select id="gang" name="gang" defaultValue={gangUser?.id ?? ""}>
            <option value="">Choose the gang lead</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.gang}</option>)}
          </select>
        </div>
        <button className="btn secondary" type="submit">Continue</button>
      </form>
      {gangUser && (
        <NewClaimForm
          action={create}
          sites={sites}
          jobs={jobs.map((j) => ({ id: j.id, siteId: j.site_id, code: j.code, site: j.site }))}
          plots={plots.map((p) => ({ id: p.id, jobId: p.job_number_id, site: p.site, job: p.job, label: `Plot ${p.plot_number}${p.house_type ? ` · ${p.house_type}` : ""}` }))}
          rates={rates}
          defaultDate={today}
          siteWarnings={warnings}
          gangUserId={gangUser.id}
        />
      )}
    </>
  );
}

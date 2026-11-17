import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createDraft, ClaimError, type ClaimType } from "@/lib/claims";
import { jobOptions, plotOptions } from "@/lib/lookups";
import { gangLiftCard, gangRateCard } from "@/lib/rates";
import { back, safeMessage, str } from "@/lib/forms";
import { isoDate } from "@/lib/dates";
import { q } from "@/lib/db";
import Flash from "@/components/Flash";
import NewClaimForm from "@/components/NewClaimForm";

async function create(f: FormData) {
  "use server";
  const user = await requireUser(["gang"]);
  const job = (await jobOptions()).find((j) => j.id === str(f, "job"));
  let id: string;
  try {
    id = await createDraft(user, {
      siteId: str(f, "site") || job?.site_id || "", jobNumberId: str(f, "job"), plotId: str(f, "plot") || null,
      claimType: str(f, "type") as ClaimType, workDate: str(f, "work_date"), stage: str(f, "stage"),
    });
  } catch (e) {
    back("/claims/new", "error", safeMessage(e, [ClaimError]));
  }
  redirect(`/claims/${id}/quantities`);
}

export default async function NewClaim({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang"]);
  const sp = await searchParams;
  const today = isoDate(new Date());
  const [jobs, plots, sites, itemRates, liftRates] = await Promise.all([
    jobOptions(),
    plotOptions(),
    q<{ id: string; name: string; region: string; client: string | null }>(
      `SELECT s.id, s.name, s.region, c.name AS client FROM ops.sites s
       LEFT JOIN ops.clients c ON c.id = s.client_id WHERE s.active ORDER BY s.name`),
    gangRateCard(user.gang_id!, today),
    gangLiftCard(today),
  ]);
  const rates = [
    ...itemRates.map((r) => ({ siteId: r.site_id, name: r.name, unit: r.unit, rate: r.rate, source: r.source })),
    ...liftRates.map((r) => ({ siteId: r.site_id, name: `${r.house_type}: ${r.name}`, unit: "lift", rate: r.value, source: r.source })),
  ];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">New claim</div><h1>Where did you work?</h1></div></div>
      <Flash sp={sp} />
      <NewClaimForm
        action={create}
        sites={sites}
        jobs={jobs.map((j) => ({ id: j.id, siteId: j.site_id, code: j.code, site: j.site }))}
        plots={plots.map((p) => ({ id: p.id, jobId: p.job_number_id, site: p.site, job: p.job, label: `Plot ${p.plot_number}${p.house_type ? ` · ${p.house_type}` : ""}` }))}
        rates={rates}
        defaultDate={today}
      />
    </>
  );
}

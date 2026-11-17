import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { loadClaim, saveQuantities, ClaimError } from "@/lib/claims";
import { claimContext, TYPE_LABEL } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { settings } from "@/lib/settings";
import ClaimSteps from "@/components/ClaimSteps";
import Flash from "@/components/Flash";

const WALL_ROWS = 8;

async function save(f: FormData) {
  "use server";
  const user = await requireUser(["gang"]);
  const id = str(f, "claim_id");
  const items: { itemId: string; quantity: number }[] = [];
  const lifts: { liftId: string; percent: number }[] = [];
  const supervision: { assignmentId: string; weeks: number }[] = [];
  const walls: { wallRef: string; courses: number }[] = [];
  for (const [k, v] of f.entries()) {
    const val = String(v).trim();
    if (val === "") continue;
    const n = Number(val);
    if (k.startsWith("item_")) items.push({ itemId: k.slice(5), quantity: n });
    if (k.startsWith("lift_")) lifts.push({ liftId: k.slice(5), percent: n });
    if (k.startsWith("sup_")) supervision.push({ assignmentId: k.slice(4), weeks: n });
  }
  for (let i = 0; i < WALL_ROWS + 20; i++) {
    const ref = str(f, `wall_ref_${i}`);
    if (ref) walls.push({ wallRef: ref, courses: Number(str(f, `wall_courses_${i}`)) });
  }
  const bad = [...items.map((i) => i.quantity), ...lifts.map((l) => l.percent), ...supervision.map((s) => s.weeks)].some((n) => !Number.isFinite(n) || n < 0);
  if (bad) back(`/claims/${id}/quantities`, "error", "Quantities must be numbers of zero or more.");
  try {
    await saveQuantities(user, id, { items, lifts, supervision, walls, notes: str(f, "notes") });
  } catch (e) {
    back(`/claims/${id}/quantities`, "error", safeMessage(e, [ClaimError]));
  }
  redirect(`/claims/${id}/evidence`);
}

export default async function Quantities({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang"]);
  const { id } = await params;
  const sp = await searchParams;
  const c = await loadClaim(user, id).catch(() => null);
  if (!c) redirect("/claims?error=Claim%20not%20found.");
  if (c.status !== "draft" && c.status !== "returned") redirect(`/claims/${id}`);
  const ctx = await claimContext(id);
  const sig = await settings.signatureRequired();
  const lines = await q<{ item_id: string | null; lift_id: string | null; supervision_assignment_id: string | null; quantity: string }>(
    "SELECT item_id, lift_id, supervision_assignment_id, quantity FROM ops.claim_lines WHERE claim_id = $1", [id]);
  const qty = (k: "item_id" | "lift_id" | "supervision_assignment_id", v: string) => lines.find((l) => l[k] === v)?.quantity ?? "";
  const walls = await q<{ wall_ref: string; courses: number }>("SELECT wall_ref, courses FROM ops.wall_measures WHERE claim_id = $1 ORDER BY wall_ref", [id]);

  const items = c.claim_type === "substructure" || c.claim_type === "daywork"
    ? await q<{ id: string; name: string; unit: string; needs_courses: boolean }>(
        "SELECT id, name, unit, needs_courses FROM ops.rate_items WHERE claim_type = $1 AND active ORDER BY sort, name", [c.claim_type])
    : [];
  const lifts = c.claim_type === "superstructure" && ctx.house_type_id
    ? await q<{ id: string; name: string; is_patch: boolean; claimed: string }>(
        `SELECT l.id, l.name, l.is_patch,
           (SELECT coalesce(sum(o.quantity), 0) FROM ops.claim_lines o JOIN ops.claims oc ON oc.id = o.claim_id
             WHERE o.lift_id = l.id AND oc.plot_id = $2 AND oc.id <> $3 AND oc.status IN ('awaiting_management', 'approved', 'paid')) AS claimed
         FROM ops.lifts l WHERE l.house_type_id = $1 ORDER BY l.sort, l.name`, [ctx.house_type_id, c.plot_id, id])
    : [];
  const sups = c.claim_type === "supervision"
    ? await q<{ id: string; name: string }>(
        `SELECT a.id, p.name FROM ops.supervision_assignments a JOIN ops.payees p ON p.id = a.payee_id
         WHERE a.site_id = $1 AND p.gang_id = $2 AND a.start_date <= $3 AND (a.end_date IS NULL OR a.end_date >= $3)`,
        [c.site_id, c.gang_id, c.work_date])
    : [];
  const wallRows = Math.max(WALL_ROWS, walls.length + 2);

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{c.ref} · {TYPE_LABEL[c.claim_type]}</div>
        <h1>Record the work</h1>
        <p className="muted small">{ctx.site} · {ctx.job}{ctx.plot ? ` · Plot ${ctx.plot}` : ""}{ctx.house_type ? ` · ${ctx.house_type}` : ""}</p></div></div>
      <ClaimSteps id={id} current="quantities" signatureRequired={sig[c.claim_type] !== false} />
      <Flash sp={sp} />
      <form action={save} className="stack">
        <input type="hidden" name="claim_id" value={id} />
        {items.length > 0 && (
          <div className="card accent">
            <h2 style={{ marginTop: 0 }}>Quantities</h2>
            <p className="muted small">Enter quantities only. The app works out every total. Rates are shown at the final step.</p>
            {items.map((i) => (
              <div key={i.id} className="split-row">
                <label htmlFor={`item_${i.id}`} style={{ margin: 0 }}>{i.name}<span className="hint">{i.unit}</span></label>
                <input id={`item_${i.id}`} name={`item_${i.id}`} type="number" inputMode="decimal" min="0" step="any" defaultValue={qty("item_id", i.id)} />
              </div>
            ))}
          </div>
        )}
        {c.claim_type === "substructure" && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Courses per wall</h2>
            <p className="muted small">Foundation depth varies. Record the number of courses for each wall, using the wall references on the foundation drawing you upload next.</p>
            {Array.from({ length: wallRows }, (_, i) => (
              <div key={i} className="wallrow">
                <div><label htmlFor={`wall_ref_${i}`} className="small">Wall reference</label>
                  <input id={`wall_ref_${i}`} name={`wall_ref_${i}`} type="text" maxLength={40} placeholder={i === 0 ? "For example: Front A" : ""} defaultValue={walls[i]?.wall_ref ?? ""} /></div>
                <div><label htmlFor={`wall_courses_${i}`} className="small">Courses</label>
                  <input id={`wall_courses_${i}`} name={`wall_courses_${i}`} type="number" inputMode="numeric" min="0" max="200" step="1" defaultValue={walls[i]?.courses ?? ""} /></div>
              </div>
            ))}
          </div>
        )}
        {c.claim_type === "superstructure" && (
          <div className="card accent">
            <h2 style={{ marginTop: 0 }}>Lifts and patch</h2>
            {!ctx.house_type_id && <div className="alert warn">This plot has no house type set up. Ask the office.</div>}
            {ctx.house_type_id && lifts.length === 0 && <div className="alert warn">No lifts are set up for this house type yet. Ask the office.</div>}
            <p className="muted small">Enter the percentage of each lift completed in this claim. You cannot claim more than what is left.</p>
            {lifts.map((l) => {
              const left = Math.max(0, 100 - Number(l.claimed));
              return (
                <div key={l.id} className="split-row">
                  <label htmlFor={`lift_${l.id}`} style={{ margin: 0 }}>{l.name}<span className="hint">{left}% left to claim</span></label>
                  <input id={`lift_${l.id}`} name={`lift_${l.id}`} type="number" inputMode="decimal" min="0" max={left} step="any" defaultValue={qty("lift_id", l.id)} disabled={left === 0} />
                </div>
              );
            })}
          </div>
        )}
        {c.claim_type === "supervision" && (
          <div className="card accent">
            <h2 style={{ marginTop: 0 }}>Supervision</h2>
            {sups.length === 0 && <div className="alert warn">Nobody in your gang is set up as a working supervisor on this site. Ask the office.</div>}
            {sups.map((s) => (
              <div key={s.id} className="split-row">
                <label htmlFor={`sup_${s.id}`} style={{ margin: 0 }}>{s.name}<span className="hint">weeks</span></label>
                <input id={`sup_${s.id}`} name={`sup_${s.id}`} type="number" inputMode="decimal" min="0" step="0.5" defaultValue={qty("supervision_assignment_id", s.id)} />
              </div>
            ))}
          </div>
        )}
        <div className="card">
          <label htmlFor="notes">Notes<span className="hint">Location, instructions or anything the office should know.</span></label>
          <textarea id="notes" name="notes" maxLength={2000} defaultValue={c.notes} />
        </div>
        <p className="muted small">Saving changes here clears any foreman signature, so the foreman signs what was finally entered.</p>
        <button className="btn" type="submit">Save and continue</button>
      </form>
    </>
  );
}

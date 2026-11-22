import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { addAttachment, addTopSheets, blobPages, loadClaim, removeAttachment, ClaimError } from "@/lib/claims";
import { listTopSheets } from "@/lib/attachments";
import { claimContext, TYPE_LABEL } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { settings } from "@/lib/settings";
import ClaimSteps from "@/components/ClaimSteps";
import Flash from "@/components/Flash";
import ImageInput from "@/components/ImageInput";
import TopSheetScanner from "@/components/TopSheetScanner";
import { storageDriver } from "@/lib/object-store";

async function upload(f: FormData) {
  "use server";
  const user = await requireUser(["gang", "management", "admin"]);
  const id = str(f, "claim_id");
  const kind = str(f, "kind");
  const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) back(`/claims/${id}/evidence`, "error", "Choose a file or take a photo first.");
  try {
    for (const file of files.slice(0, 12)) await addAttachment(user, id, kind, file);
  } catch (e) {
    back(`/claims/${id}/evidence`, "error", safeMessage(e, [ClaimError]));
  }
  back(`/claims/${id}/evidence`, "ok", `${files.length} file${files.length > 1 ? "s" : ""} uploaded.`);
}

async function saveTopSheet(f: FormData) {
  "use server";
  const user = await requireUser(["gang", "management", "admin"]);
  const id = str(f, "claim_id");
  const files = f.getAll("pages").filter((x): x is File => x instanceof File && x.size > 0);
  const blobs = blobPages(f);
  try { await addTopSheets(user, id, files, blobs); }
  catch (e) { back(`/claims/${id}/evidence`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}/evidence`, "ok", "Top sheet saved.");
}

async function remove(f: FormData) {
  "use server";
  const user = await requireUser(["gang", "management", "admin"]);
  const id = str(f, "claim_id");
  try { await removeAttachment(user, id, str(f, "attachment_id")); }
  catch (e) { back(`/claims/${id}/evidence`, "error", safeMessage(e, [ClaimError])); }
  redirect(`/claims/${id}/evidence`);
}

const KIND_LABEL: Record<string, string> = { photo: "Work photos", drawing: "Foundation drawing", daywork_sheet: "Signed client daywork sheet", client_form: "Client's own form" };

export default async function Evidence({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang", "management", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  const c = await loadClaim(user, id).catch(() => null);
  if (!c) redirect("/claims?error=Claim%20not%20found.");
  if (c.status !== "draft" && c.status !== "returned") redirect(`/claims/${id}`);
  const ctx = await claimContext(id);
  const [minPhotos, sig] = await Promise.all([settings.minPhotos(), settings.signatureRequired()]);
  const client = await q1<{ uses_own_forms: boolean }>("SELECT uses_own_forms FROM ops.clients WHERE id = $1", [c.client_id]);
  const files = await q<{ id: string; kind: string; original_name: string; mime: string }>(
    "SELECT id, kind, original_name, mime FROM ops.attachments WHERE claim_id = $1 AND kind <> 'signature' AND kind <> 'top_sheet' ORDER BY uploaded_at", [id]);
  const sheets = await listTopSheets(id);
  const kinds = ["photo", ...(c.claim_type === "substructure" ? ["drawing"] : []), ...(c.claim_type === "daywork" ? ["daywork_sheet"] : []), "client_form"];
  const need = Math.max(1, minPhotos[c.claim_type] ?? 1);
  const next = sig[c.claim_type] !== false ? "sign" : "split";
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{c.ref} · {TYPE_LABEL[c.claim_type]}</div>
        <h1>Photos and documents</h1>
        <p className="muted small">{ctx.site} · {ctx.job}{ctx.plot ? ` · Plot ${ctx.plot}` : ""}</p></div></div>
      <ClaimSteps id={id} current="evidence" signatureRequired={sig[c.claim_type] !== false} />
      <Flash sp={sp} />
      <div className="card accent">
        <h2 style={{ marginTop: 0 }}>Top sheet <span className="badge">Optional</span></h2>
        <p className="muted small">Scan the paper top sheet, or upload the PDF. On a phone, the camera opens for each page. The office sees it with the claim. It is not included in the client backup pack.</p>
        {sheets.length > 0 && (
          <div className="thumbs" style={{ marginBottom: 12 }}>
            {sheets.map((f, i) => (
              <figure key={f.id}>
                {f.mime.startsWith("image/")
                  ? <img src={`/api/files/${f.id}`} alt={`Top sheet page ${i + 1}`} />
                  : <a className="file-tile" href={`/api/files/${f.id}`}>PDF</a>}
                <figcaption>Page {i + 1}</figcaption>
                <form action={remove}><input type="hidden" name="claim_id" value={id} /><input type="hidden" name="attachment_id" value={f.id} />
                  <button className="btn secondary small" type="submit">Remove</button></form>
              </figure>
            ))}
          </div>
        )}
        <TopSheetScanner action={saveTopSheet} claimId={id} useBlob={storageDriver() === "vercel-blob"} />
      </div>
      <div className="alert info">Photos are required before this claim can be submitted (at least {need}). Keep the plot number or a landmark in shot where you can.</div>
      {client?.uses_own_forms && <div className="alert warn">This client may only accept its own forms. Fill in their form as usual and add a photo or scan of it below.</div>}
      {kinds.map((k) => {
        const mine = files.filter((f) => f.kind === k);
        const required = k === "photo" || k === "drawing" || k === "daywork_sheet";
        return (
          <div key={k} className="card">
            <h2 style={{ marginTop: 0 }}>{KIND_LABEL[k]} {required ? <span className="badge awaiting_management">Required</span> : <span className="badge">Optional</span>}</h2>
            {mine.length > 0 && (
              <div className="thumbs" style={{ marginBottom: 12 }}>
                {mine.map((f) => (
                  <figure key={f.id}>
                    {f.mime.startsWith("image/") && f.mime !== "image/heic"
                      ? <img src={`/api/files/${f.id}`} alt={f.original_name} />
                      : <div className="file-tile">PDF</div>}
                    <figcaption>{f.original_name}</figcaption>
                    <form action={remove}><input type="hidden" name="claim_id" value={id} /><input type="hidden" name="attachment_id" value={f.id} />
                      <button className="btn secondary small" type="submit">Remove</button></form>
                  </figure>
                ))}
              </div>
            )}
            <form action={upload} className="stack">
              <input type="hidden" name="claim_id" value={id} /><input type="hidden" name="kind" value={k} />
              <ImageInput name="files" label={mine.length ? "Add more" : "Take a photo or choose a file"} document={k !== "photo"} multiple={k === "photo"} required />
              <button className="btn secondary" type="submit">Upload</button>
            </form>
          </div>
        );
      })}
      <a className="btn" href={`/claims/${id}/${next}`}>Continue</a>
    </>
  );
}

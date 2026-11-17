"use client";
import { useRef } from "react";

export default function DeleteClaimDialog({
  action, claimId, blocked,
}: {
  action: (f: FormData) => void;
  claimId: string;
  blocked: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  if (blocked) return <p className="small muted" data-testid="delete-blocked">{blocked}</p>;
  return (
    <div data-testid="delete-claim">
      <button type="button" className="btn danger" onClick={() => ref.current?.showModal()}>Delete claim</button>
      <dialog ref={ref} className="confirm-dialog">
        <form action={action} className="stack">
          <h2 style={{ marginTop: 0 }}>Delete this claim?</h2>
          <p className="small muted">It leaves the lists and frees any lift allowance it used. The office can restore it from Setup. This is not undone from here.</p>
          <input type="hidden" name="claim_id" value={claimId} />
          <div><label htmlFor="delete_reason">Reason</label><textarea id="delete_reason" name="reason" required minLength={3} maxLength={500} /></div>
          <label className="check"><input type="checkbox" name="confirm" required /> I confirm I want to delete this claim</label>
          <div className="actions">
            <button className="btn danger" type="submit">Delete claim</button>
            <button className="btn ghost" type="button" onClick={() => ref.current?.close()}>Cancel</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

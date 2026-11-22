"use client";

import { useState } from "react";
import SignaturePad from "@/components/SignaturePad";

export default function SignFormClient({
  token, name, docLabel, action,
}: {
  token: string;
  name: string;
  docLabel: string;
  action: (f: FormData) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await action(new FormData(e.currentTarget));
      if (result.error) setError(result.error);
      else setDone(true);
    } catch {
      setError("We could not save your signature. Check your connection and try again.");
    }
    setPending(false);
  }

  if (done) {
    return (
      <div className="sign-success" role="status">
        <p className="eyebrow">Recorded</p>
        <h2>Thank you. Your signature has been saved.</h2>
        <p>You can close this page. The office has a copy of the document and your signature.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="stack sign-form">
      <input type="hidden" name="token" value={token} />
      <h2 className="sign-step">2. Your details</h2>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div>
        <label htmlFor="full_name">Full name</label>
        <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={80} defaultValue={name} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="company">Company or gang (optional)</label>
        <input id="company" name="company" type="text" maxLength={120} autoComplete="organization" />
      </div>
      <h2 className="sign-step">3. Sign</h2>
      <div>
        <label>Draw your signature</label>
        <SignaturePad name="signature" />
      </div>
      <label className="check">
        <input type="checkbox" name="confirm" required />
        I confirm I have read and understood this {docLabel} and will work in accordance with it.
      </label>
      <button className="btn sign-submit" type="submit" disabled={pending}>
        {pending ? "Saving your signature..." : "Sign"}
      </button>
    </form>
  );
}

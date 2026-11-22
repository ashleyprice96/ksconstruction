"use client";

import { useState } from "react";
import SignaturePad from "@/components/SignaturePad";

export default function SignFormClient({
  token, name, action,
}: {
  token: string;
  name: string;
  action: (f: FormData) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const result = await action(new FormData(e.currentTarget));
    setPending(false);
    if (result.error) setError(result.error);
    else setDone(true);
  }

  if (done) return <p className="lede">You have signed this. Thank you.</p>;
  return (
    <form onSubmit={onSubmit} className="stack">
      <input type="hidden" name="token" value={token} />
      {error && <div className="alert error" role="alert">{error}</div>}
      <div>
        <label htmlFor="full_name">Full name</label>
        <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={80} defaultValue={name} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="company">Company / gang (optional)</label>
        <input id="company" name="company" type="text" maxLength={120} autoComplete="organization" />
      </div>
      <div>
        <label>Draw your signature</label>
        <SignaturePad name="signature" />
      </div>
      <label className="check">
        <input type="checkbox" name="confirm" required /> I have read and understood
      </label>
      <button className="btn" type="submit" disabled={pending} style={{ minHeight: 52, fontSize: "1.05rem" }}>{pending ? "Saving…" : "Sign"}</button>
    </form>
  );
}

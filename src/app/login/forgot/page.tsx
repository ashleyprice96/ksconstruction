import Link from "next/link";
import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/passwords";
import { str } from "@/lib/forms";

async function ask(f: FormData) {
  "use server";
  await requestPasswordReset(str(f, "login"));
  redirect("/login/forgot?sent=1");
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">K-S Construction Group</p>
        <h1>Reset request</h1>
        {sp.sent ? (
          <p className="lede">Your request has been sent to the K-S office.</p>
        ) : (
          <>
            <p className="lede">Tell us the email or username on the account. The office will set a temporary password.</p>
            <form action={ask} className="stack">
              <div><label htmlFor="login">Email or username</label><input id="login" name="login" type="text" autoComplete="username" required /></div>
              <button className="btn" type="submit">Send request</button>
            </form>
          </>
        )}
        <p className="small" style={{ margin: "16px 0 0" }}><Link href="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}

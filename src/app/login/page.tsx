import { redirect } from "next/navigation";
import { currentUser, login } from "@/lib/auth";
import { str } from "@/lib/forms";

async function doLogin(f: FormData) {
  "use server";
  const ok = await login(str(f, "email"), String(f.get("password") ?? ""));
  redirect(ok ? "/" : "/login?error=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await currentUser()) redirect("/");
  const sp = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">K-S Construction Group</p>
        <h1>Claims</h1>
        <p className="lede">Sign in with your K-S account.</p>
        {sp.error && <div className="alert error" role="alert">Email or password not recognised.</div>}
        <form action={doLogin} className="stack">
          <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
          <div><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="btn" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}

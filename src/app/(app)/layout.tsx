import Link from "next/link";
import { requireUser, logout } from "@/lib/auth";
import { isNamedUser } from "@/lib/commercial";
import { redirect } from "next/navigation";

const ROLE_LABEL = { gang: "Gang", contracts_manager: "Contracts manager", management: "Management", admin: "Administrator" } as const;

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const named = await isNamedUser(user);
  const mgr = user.role === "management" || user.role === "admin";
  const links: { href: string; label: string; restricted?: boolean }[] = [
    { href: "/", label: "Home" },
    { href: "/claims", label: "Claims" },
    { href: "/issues", label: "Snags" },
  ];
  if (user.role === "gang") links.splice(2, 0, { href: "/payments/mine", label: "My payments" });
  if (mgr) links.push({ href: "/payments", label: "Pay runs" }, { href: "/rates", label: "Gang rates" }, { href: "/setup", label: "Setup" });
  if (named) links.push({ href: "/commercial", label: "Margin", restricted: true });
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <img src="/ks-logo.png" alt="" />
            <span>K-S<small>CLAIMS</small></span>
          </Link>
          <div className="who">
            <span className="name">{user.name} · </span>{ROLE_LABEL[user.role]}
            <br />
            <form action={signOut}><button type="submit">Sign out</button></form>
          </div>
        </div>
        <nav className="mainnav" aria-label="Main">
          <ul>
            {links.map((l) => (
              <li key={l.href}><Link href={l.href} className={l.restricted ? "restricted" : undefined}>{l.label}</Link></li>
            ))}
          </ul>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}

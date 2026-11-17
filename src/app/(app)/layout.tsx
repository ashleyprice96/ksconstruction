import Link from "next/link";
import { requireUser, logout } from "@/lib/auth";
import { isNamedUser } from "@/lib/commercial";
import { redirect } from "next/navigation";
import MainNav from "@/components/MainNav";
import ThemeToggle from "@/components/ThemeToggle";

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
      <a className="skip" href="#content">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <img src="/ks-logo.png" alt="" width={40} height={40} />
            <span><b>K-S</b><small>CLAIMS</small></span>
          </Link>
          <div className="who">
            <div className="who-id">
              <span className="name">{user.name}</span>
              <span className="role">{ROLE_LABEL[user.role]}</span>
            </div>
            <ThemeToggle />
            <form action={signOut}><button type="submit">Sign out</button></form>
          </div>
        </div>
        <MainNav links={links} />
      </header>
      <main id="content">{children}</main>
    </>
  );
}

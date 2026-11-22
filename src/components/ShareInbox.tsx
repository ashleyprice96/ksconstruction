import Link from "next/link";
import { SHARE_KIND_LABEL, unsignedShares } from "@/lib/share";

/** Shared documents this person has not signed. */
export default async function ShareInbox({ userId }: { userId: string }) {
  const rows = await unsignedShares(userId);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>To sign</h2>
      <ul className="stack">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/sign/${row.token}`}>{SHARE_KIND_LABEL[row.kind]}{row.site_name ? ` · ${row.site_name}` : ""}: {row.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

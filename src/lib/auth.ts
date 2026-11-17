import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { q, q1 } from "./db";

export type Role = "gang" | "contracts_manager" | "management" | "admin";

export interface User {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  role: Role;
  gang_id: string | null;
  must_change_password: boolean;
}

const COOKIE = "ks_session";
const SESSION_DAYS = 14;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function login(loginId: string, password: string): Promise<"ok" | "change" | "no"> {
  const id = loginId.trim().toLowerCase();
  const u = await q1<{ id: string; password_hash: string; must_change_password: boolean }>(
    `SELECT id, password_hash, must_change_password FROM ops.users
     WHERE active AND (lower(email) = $1 OR lower(username) = $1)`, [id]);
  // Always run bcrypt so response time does not reveal whether the account exists.
  const ok = await bcrypt.compare(password, u?.password_hash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!u || !ok) return "no";
  const token = randomBytes(32).toString("base64url");
  await q("INSERT INTO ops.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)",
    [hashToken(token), u.id, `${SESSION_DAYS} days`]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.SECURE_COOKIES === "true",
    maxAge: SESSION_DAYS * 86400,
  });
  return u.must_change_password ? "change" : "ok";
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await q("DELETE FROM ops.sessions WHERE token_hash = $1", [hashToken(token)]);
  jar.delete(COOKIE);
}

export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return q1<User>(
    `SELECT u.id, u.email, u.username, u.name, u.role, u.gang_id, u.must_change_password FROM ops.sessions s
     JOIN ops.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [hashToken(token)]);
});

/** Page guard: redirects to login, or shows a generic refusal for the wrong role. */
export async function requireUser(roles?: Role[], opts?: { allowPasswordChange?: boolean }): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.must_change_password && !opts?.allowPasswordChange) redirect("/account/password");
  if (roles && !roles.includes(u.role)) redirect("/?denied=1");
  return u;
}

export const isManager = (u: User) => u.role === "management" || u.role === "admin";

export async function hashPassword(p: string) {
  return bcrypt.hash(p, 12);
}

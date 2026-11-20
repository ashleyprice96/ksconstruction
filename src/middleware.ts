import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { claimsPathBlocked } from "./lib/features";

export function middleware(request: NextRequest) {
  if (!claimsPathBlocked(request.nextUrl.pathname)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/claims/:path*", "/payments/:path*", "/rates/:path*", "/commercial/:path*", "/issues/:path*", "/notices/:path*", "/api/commercial/:path*", "/api/payruns/:path*", "/api/invoices/:path*", "/api/backup/:path*", "/api/files/:path*"],
};

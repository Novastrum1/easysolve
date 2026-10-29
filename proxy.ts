import { NextRequest, NextResponse } from "next/server";
// Routing convenience only: admin pages and APIs independently authorize sessions.
export function proxy(request: NextRequest) {
  const host = process.env.ADMIN_HOST?.trim().toLowerCase();
  if (
    host &&
    request.nextUrl.host.toLowerCase() === host &&
    request.nextUrl.pathname === "/"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/"] };

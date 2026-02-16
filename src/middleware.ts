import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Skip auth for login page and API
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/login"
  ) {
    return NextResponse.next();
  }

  // Skip if no password configured
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  // Check auth cookie
  const auth = request.cookies.get("pyaar-auth")?.value;
  if (auth === password) return NextResponse.next();

  // Redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|data/|.*\\.wasm|.*\\.worker\\.js).*)"],
};

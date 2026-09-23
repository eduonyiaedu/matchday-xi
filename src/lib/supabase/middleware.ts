import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, isValidDeviceId } from "@/lib/device-id";

/**
 * Refreshes the Supabase auth session cookie on every request and redirects
 * unauthenticated users away from protected routes.
 */
export async function updateSession(request: NextRequest) {
  // First visit from this browser: give it a device id (lib/device-id.ts). Put on the request too,
  // so the pages rendering this same request already see it. Page loads only, never /api/*: a
  // Set-Cookie stops Vercel's CDN caching a response (the share-card images, fetched cookie-less by
  // link-preview bots), and a cached response carrying one would hand many browsers the same id.
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const newDeviceId = isApi || isValidDeviceId(request.cookies.get(DEVICE_COOKIE)?.value) ? null : crypto.randomUUID();
  if (newDeviceId) request.cookies.set(DEVICE_COOKIE, newDeviceId);
  const withDeviceCookie = (response: NextResponse) => {
    if (newDeviceId) {
      response.cookies.set(DEVICE_COOKIE, newDeviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: DEVICE_COOKIE_MAX_AGE,
      });
    }
    return response;
  };

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPrefixes = [
    "/home",
    "/predict",
    "/fixtures",
    "/history",
    "/leagues",
    "/prizes",
    "/onboarding",
    "/admin",
    "/settings",
  ];
  const isProtected = protectedPrefixes.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return withDeviceCookie(NextResponse.redirect(redirectUrl));
  }

  return withDeviceCookie(supabaseResponse);
}

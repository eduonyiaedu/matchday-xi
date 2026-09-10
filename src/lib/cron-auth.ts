import { NextRequest, NextResponse } from "next/server";

/**
 * Verifies the `Authorization: Bearer <CRON_SECRET>` header the GitHub Actions workflows send.
 * Returns a 401 response to short-circuit with if the check fails, otherwise null.
 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

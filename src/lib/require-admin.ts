import { NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";

export async function requireAdmin() {
  const user = await getOrCreateCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, response: null };
}

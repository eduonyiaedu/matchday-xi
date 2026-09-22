import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

const schema = z.object({ username: z.string().regex(/^[a-z0-9_]{3,20}$/) });

/**
 * Creates the app-level User row (with consent timestamps) for the interstitial at
 * /auth/consent — the one path where a brand-new Google account needs age/ToS consent collected
 * after the fact, since Google OAuth doesn't distinguish a login-page click from a signup-page one.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.user.findUnique({ where: { id: authUser.id } });
  if (existing) return NextResponse.json({ user: existing });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Username must be 3-20 characters: lowercase letters, numbers, underscore only." }, { status: 400 });
  }

  const usernameTaken = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (usernameTaken) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 400 });
  }

  const now = new Date();
  const displayName =
    (authUser.user_metadata?.full_name as string | undefined) ?? authUser.email?.split("@")[0] ?? "Player";

  try {
    const user = await prisma.user.create({
      data: {
        id: authUser.id,
        email: authUser.email ?? "",
        username: parsed.data.username,
        displayName,
        ageConfirmedAt: now,
        tosConsentedAt: now,
      },
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // error.meta.target isn't a reliable column-array to distinguish which constraint fired
      // (id vs. username) — re-query by the actual unique field instead, same pattern already
      // established in lib/auth.ts for this exact create()-race shape. Two concurrent submits
      // for this same Google identity (e.g. two tabs open on /auth/consent) both pass the
      // `existing` check above before either commits — the loser's create() throws P2002 on the
      // PRIMARY KEY, not necessarily on username, so it shouldn't be told its username was taken
      // when the real story is "your account already exists, from the other request."
      const byId = await prisma.user.findUnique({ where: { id: authUser.id } });
      if (byId) return NextResponse.json({ user: byId });

      return NextResponse.json({ error: "That username is already taken." }, { status: 400 });
    }
    throw error;
  }
}

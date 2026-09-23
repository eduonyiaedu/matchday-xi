import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { DEVICE_COOKIE, isValidDeviceId } from "@/lib/device-id";

const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";

/**
 * Well-known throwaway-inbox services — the cheapest way to mass-create accounts to enter the
 * prize draws more than once. Not exhaustive (new ones appear constantly); it catches the casual
 * case, and anything else still has to get past the other checks and the founder's review.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com", "20minutemail.com", "burnermail.io", "discard.email", "dispostable.com",
  "emailondeck.com", "fakeinbox.com", "getairmail.com", "getnada.com", "guerrillamail.com",
  "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "grr.la", "inboxbear.com",
  "mail.tm", "mailcatch.com", "maildrop.cc", "mailinator.com", "mailinator.net", "mailnesia.com",
  "mailpoof.com", "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "nada.email",
  "sharklasers.com", "spamgourmet.com", "temp-mail.io", "temp-mail.org", "tempail.com",
  "tempmail.com", "tempmail.dev", "tempmailo.com", "tempr.email", "throwawaymail.com",
  "trashmail.com", "trashmail.de", "yopmail.com", "yopmail.fr", "yopmail.net",
]);

/**
 * One inbox, however it's spelled: lower-cased, "+anything" dropped (most providers deliver
 * name+x@ to name@), and for Gmail the dots too (Gmail ignores them) — so
 * "J.Smith+prizes2@googlemail.com" and "jsmith@gmail.com" come out the same.
 */
export function normalizeEmail(email: string): string {
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split("@");
  if (!rawDomain) return email.trim().toLowerCase();
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function isDisposableEmail(email: string): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has(normalizeEmail(email).split("@")[1] ?? "");
}

/**
 * Checked once, when a new account's profile is created: flags it — out of prize contention, still
 * free to play; the founder can clear the flag on /admin — if it's a throwaway inbox, or the same
 * inbox as an existing account under a different spelling (the usual way to enter the prize draws
 * more than once). Never blocks sign-up: a false positive costs a genuine player nothing but a
 * prize check, and a flag is visible to the founder with its reason.
 */
export async function assessNewAccount(email: string): Promise<{ normalizedEmail: string; flagReason: string | null }> {
  const normalizedEmail = normalizeEmail(email);
  if (isDisposableEmail(email)) return { normalizedEmail, flagReason: "Throwaway email address" };
  const twin = await prisma.user.findFirst({
    where: { normalizedEmail, NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } } },
    select: { username: true },
  });
  if (twin) return { normalizedEmail, flagReason: `Same inbox as @${twin.username} (a different spelling of the same email)` };
  return { normalizedEmail, flagReason: null };
}

/**
 * Remembers that this account was used on this device (the browser's device-id cookie — see
 * lib/device-id.ts), called on every signed-in page load: a single insert that does nothing for
 * an already-known pair. The first time an account turns up on a device another account already
 * uses, every account on that device except the oldest is flagged out of prize contention —
 * several accounts on one phone is the usual way to enter the prize draws more than once. Never
 * blocks anything; admins are never flagged, and an account the founder has cleared
 * (flagClearedAt) is never re-flagged automatically — a shared family phone is a real case.
 */
export async function recordDeviceUse(userId: string): Promise<void> {
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!isValidDeviceId(deviceId)) return;
  const { count } = await prisma.userDevice.createMany({ data: [{ userId, deviceId }], skipDuplicates: true });
  if (count === 0) return;

  const links = await prisma.userDevice.findMany({
    where: { deviceId, user: { NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } } } },
    select: { user: { select: { id: true, username: true, createdAt: true, role: true, isFlaggedDuplicate: true, flagClearedAt: true } } },
  });
  if (links.length < 2) return;
  const [oldest, ...newer] = links.map((l) => l.user).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const toFlag = newer.filter((u) => u.role !== "ADMIN" && !u.isFlaggedDuplicate && !u.flagClearedAt).map((u) => u.id);
  if (toFlag.length === 0) return;
  await prisma.user.updateMany({
    where: { id: { in: toFlag }, isFlaggedDuplicate: false, flagClearedAt: null },
    data: { isFlaggedDuplicate: true, flagReason: `Used on the same device as @${oldest.username}` },
  });
}

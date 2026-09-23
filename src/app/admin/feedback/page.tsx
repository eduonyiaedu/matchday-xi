import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/layout/footer";
import { LocalTime } from "@/components/ui/local-time";

/**
 * Feedback left on the profile page's "Delete account" sheet. AccountDeletionFeedback stores only
 * the user id (deliberately no relation, so it outlives the user row's anonymization), so names
 * and emails are looked up from the User rows as they are NOW: readable while a deletion is still
 * pending or was cancelled, and shown as "Deleted user" once PURGE_EXPIRED_ACCOUNTS has
 * anonymized the account — by design, the feedback outlives the personal details.
 */
export default async function AdminFeedbackPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const feedback = await prisma.accountDeletionFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(feedback.map((f) => f.submittedByUserId))] } },
    select: { id: true, displayName: true, username: true, email: true, deletionScheduledAt: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  function status(u: (typeof users)[number] | undefined) {
    if (!u || u.email.endsWith("@deleted.matchday-xi.app")) return { label: "Account deleted", variant: "secondary" as const };
    if (u.deletionScheduledAt) return { label: "Deletion pending", variant: "destructive" as const };
    return { label: "Cancelled — logged back in", variant: "outline" as const };
  }

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Account deletion feedback</h1>
          <p className="text-sm text-muted-foreground">
            What people said when deleting their account. Names and emails stay visible during the
            30-day grace period, then are removed when the account is permanently deleted.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {feedback.length === 0 ? "No feedback yet" : `${feedback.length} response${feedback.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {feedback.length === 0 && (
              <p className="text-muted-foreground">Nobody has deleted their account yet.</p>
            )}
            {feedback.map((f) => {
              const u = userById.get(f.submittedByUserId);
              const s = status(u);
              const deleted = s.label === "Account deleted";
              return (
                <div key={f.id} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{deleted ? "Deleted user" : u?.displayName}</p>
                      {!deleted && u && (
                        <p className="text-xs text-muted-foreground">
                          @{u.username} · {u.email}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.variant}>{s.label}</Badge>
                      <span className="text-xs text-muted-foreground">
                        <LocalTime iso={f.createdAt.toISOString()} />
                      </span>
                    </div>
                  </div>
                  <p className={f.feedback ? "whitespace-pre-wrap" : "text-muted-foreground italic"}>
                    {f.feedback || "No feedback given."}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}

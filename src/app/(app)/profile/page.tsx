import { getOrCreateCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocalTime } from "@/components/ui/local-time";
import { BackLink } from "@/components/ui/back-link";
import { DeleteAccountButton } from "@/components/profile/delete-account-button";
import { formatDeletionBlock, leagueCreatorDeletionBlock } from "@/lib/account-deletion";

export default async function ProfilePage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;
  const deletionBlock = await leagueCreatorDeletionBlock(user.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink fallbackHref="/home" />
        <h1 className="text-2xl font-bold">Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Name:</span> {user.displayName}
          </p>
          <p>
            <span className="text-muted-foreground">Username:</span> @{user.username}
          </p>
          <p>
            <span className="text-muted-foreground">Email:</span> {user.email}
          </p>
          <p>
            <span className="text-muted-foreground">Member since:</span>{" "}
            <LocalTime iso={user.createdAt.toISOString()} dateOnly />
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            This permanently removes your login and personal details. Your account isn&apos;t
            deleted immediately — you have 30 days to change your mind.
          </p>
          {deletionBlock ? (
            <p className="rounded-lg bg-white/5 p-3">{formatDeletionBlock(deletionBlock)}</p>
          ) : (
            <DeleteAccountButton />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

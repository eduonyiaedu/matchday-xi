import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { ManualSyncButtons } from "@/components/admin/manual-sync-button";
import { Footer } from "@/components/layout/footer";

export default async function AdminSyncPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Sync options</h1>
        </div>

        <ManualSyncButtons />
      </div>
      <Footer />
    </div>
  );
}

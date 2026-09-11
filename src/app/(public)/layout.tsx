import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/layout/footer";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <Link href="/" className="text-lg font-bold">
            Matchday XI
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href={user ? "/fixtures" : "/login"}>{user ? "Open app" : "Log in"}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
      <Footer />
    </div>
  );
}

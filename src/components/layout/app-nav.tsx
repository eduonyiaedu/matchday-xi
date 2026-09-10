"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/fixtures", label: "Fixtures" },
  { href: "/history", label: "History" },
  { href: "/leaderboards/global", label: "Leaderboards" },
  { href: "/leagues", label: "Private Leagues" },
  { href: "/prizes", label: "Prizes" },
];

export function AppNav({
  displayName,
  currentStreak,
  totalPoints,
  role,
}: {
  displayName: string;
  currentStreak: number;
  totalPoints: number;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 p-4">
        <Link href="/fixtures" className="text-lg font-bold">
          Matchday XI
        </Link>
        <nav className="flex flex-1 flex-wrap gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted",
                pathname.startsWith(link.href) && "bg-muted",
              )}
            >
              {link.label}
            </Link>
          ))}
          {role === "ADMIN" && (
            <Link
              href="/admin"
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted",
                pathname.startsWith("/admin") && "bg-muted",
              )}
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">🔥 {currentStreak}d</Badge>
          <Badge variant="secondary">{totalPoints} pts</Badge>
          <span className="hidden text-muted-foreground sm:inline">{displayName}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}

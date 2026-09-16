"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Exact 20x20 stroke-mark path data from the design's tab-bar icon set.
const NAV_ICONS: Record<string, string> = {
  home: '<rect x="2.5" y="3" width="15" height="14" rx="1.5"></rect><line x1="2.5" y1="10" x2="17.5" y2="10"></line><circle cx="10" cy="10" r="3"></circle>',
  fixtures: '<circle cx="10" cy="10" r="7"></circle><path d="M10 5.5V10l3 1.8"></path>',
  tables: '<path d="M6 3h8v4a4 4 0 0 1-8 0V3Z"></path><path d="M6 4.5H3.5V6a2.5 2.5 0 0 0 2.5 2.5"></path><path d="M14 4.5h2.5V6A2.5 2.5 0 0 1 14 8.5"></path><line x1="10" y1="11" x2="10" y2="14.5"></line><line x1="6.5" y1="16.5" x2="13.5" y2="16.5"></line>',
  leagues: '<path d="M10 2.5 16.5 5v5.5c0 3.6-2.6 6-6.5 7-3.9-1-6.5-3.4-6.5-7V5L10 2.5Z"></path>',
  prizes: '<path d="M10 1.5C10 5 14 5.6 14 9.8c0 2-1.2 3.6-2.9 4.2.6-1.2.4-2.7-.7-3.6.2 2-1.4 2.6-2.4 3.8-.9 1-.9 2.6.1 3.8C5.6 17.2 4 15 4 12.3 4 7.8 8.5 7.2 10 1.5Z"></path>',
  admin: '<circle cx="10" cy="10" r="2.3"></circle><path d="M10 3v2.2M10 14.8V17M17 10h-2.2M5.2 10H3M14.7 5.3l-1.6 1.6M6.9 13.1l-1.6 1.6M14.7 14.7l-1.6-1.6M6.9 6.9 5.3 5.3"></path>',
};

const LINKS = [
  { href: "/home", icon: "home", shortLabel: "Home", label: "Home" },
  { href: "/fixtures", icon: "fixtures", shortLabel: "Fixtures", label: "Fixtures" },
  { href: "/leaderboards/global", icon: "tables", shortLabel: "Tables", label: "Leaderboards" },
  { href: "/leagues", icon: "leagues", shortLabel: "Leagues", label: "Leagues" },
  { href: "/prizes", icon: "prizes", shortLabel: "Prizes", label: "Prizes" },
];

export function AppNav({
  displayName,
  username,
  currentStreak,
  totalPoints,
  role,
  teamInitials,
}: {
  displayName: string;
  username: string;
  currentStreak: number;
  totalPoints: number;
  role: string;
  teamInitials: string;
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
    <>
      {/* Desktop / tablet top bar (>=768px) */}
      <header className="hidden border-b border-white/8 md:block">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 p-4">
          <Link href="/home" className="flex items-baseline gap-1.5">
            <span className="font-heading text-[15px] font-bold tracking-[0.06em] uppercase">Matchday</span>
            <span className="font-heading text-[15px] font-bold tracking-[0.06em] text-gold uppercase">XI</span>
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {LINKS.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-lg px-3 py-1.5 font-heading text-xs tracking-[0.1em] uppercase",
                    active ? "bg-club/16 text-club" : "text-muted-foreground hover:text-chalk",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            {role === "ADMIN" && (
              <Link
                href="/admin"
                className={cn(
                  "rounded-lg px-3 py-1.5 font-heading text-xs tracking-[0.1em] uppercase",
                  pathname.startsWith("/admin") ? "bg-club/16 text-club" : "text-muted-foreground hover:text-chalk",
                )}
              >
                Admin
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <Badge>🔥 {currentStreak}d</Badge>
            <Badge variant="secondary">{totalPoints} pts</Badge>
            <span className="hidden text-muted-foreground sm:inline">
              {displayName} <span className="text-xs">@{username}</span>
            </span>
            <div className="flex size-8 items-center justify-center rounded-full bg-club font-heading text-[11px] font-bold text-pitch">
              {teamInitials}
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile fixed bottom tab bar (<768px) — a 7th slot appears only for admins */}
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 grid border-t border-white/9 bg-pitch/95 px-1 pt-2.5 pb-4 md:hidden",
          role === "ADMIN" ? "grid-cols-6" : "grid-cols-5",
        )}
      >
        {[...LINKS, ...(role === "ADMIN" ? [{ href: "/admin", icon: "admin", shortLabel: "Admin", label: "Admin" }] : [])].map(
          (link) => {
            const active = pathname.startsWith(link.href);
            const color = active ? "var(--club)" : "var(--muted)";
            return (
              <Link key={link.href} href={link.href} className="flex flex-col items-center gap-1">
                <svg
                  width={20}
                  height={20}
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  dangerouslySetInnerHTML={{ __html: NAV_ICONS[link.icon] }}
                />
                <span className="font-heading text-[9px] tracking-[0.06em] uppercase" style={{ color }}>
                  {link.shortLabel}
                </span>
              </Link>
            );
          },
        )}
      </nav>
    </>
  );
}

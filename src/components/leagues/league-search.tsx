"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface LeagueSummary {
  id: string;
  name: string;
  creatorName: string;
  memberCount: number;
}

export function LeagueSearch({ initialLeagues }: { initialLeagues: LeagueSummary[] }) {
  const [leagues, setLeagues] = useState(initialLeagues);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    setQuery(value);
    startTransition(async () => {
      const res = await fetch(`/api/leagues?q=${encodeURIComponent(value)}`);
      const body = await res.json();
      setLeagues(
        body.leagues.map((l: { id: string; name: string; creator: { displayName: string }; _count: { memberships: number } }) => ({
          id: l.id,
          name: l.name,
          creatorName: l.creator.displayName,
          memberCount: l._count.memberships,
        })),
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search leagues by name..."
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {leagues.map((l) => (
          <Link key={l.id} href={`/leagues/${l.id}`}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{l.name}</CardTitle>
                <CardDescription>
                  by {l.creatorName} · {l.memberCount} members
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
        {!isPending && leagues.length === 0 && (
          <p className="text-sm text-muted-foreground">No leagues found.</p>
        )}
      </div>
    </div>
  );
}

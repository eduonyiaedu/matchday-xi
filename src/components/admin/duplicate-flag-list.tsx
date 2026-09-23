"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isFlaggedDuplicate: boolean;
}

export function DuplicateFlagList({ users }: { users: UserRow[] }) {
  const [rows, setRows] = useState(users);
  const [pending, setPending] = useState<Set<string>>(new Set());

  function setFlag(userId: string, flagged: boolean) {
    setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, isFlaggedDuplicate: flagged } : u)));
  }

  async function toggle(userId: string, flagged: boolean) {
    // Optimistic, but reverted on failure — this flag decides prize eligibility, so the switch
    // must never show a state the database doesn't actually hold.
    setFlag(userId, flagged);
    setPending((prev) => new Set(prev).add(userId));
    try {
      const res = await fetch("/api/admin/flag-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, flagged }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't update the flag.");
      }
    } catch (error) {
      setFlag(userId, !flagged);
      toast.error(error instanceof Error ? error.message : "Couldn't update the flag.");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No users match.</p>;
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {rows.map((u) => (
        <div key={u.id} className="flex items-center justify-between border-b pb-1 last:border-0">
          <div>
            <p>{u.displayName}</p>
            <p className="text-xs text-muted-foreground">{u.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Flagged duplicate</span>
            <Switch
              checked={u.isFlaggedDuplicate}
              disabled={pending.has(u.id)}
              onCheckedChange={(v) => toggle(u.id, v)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

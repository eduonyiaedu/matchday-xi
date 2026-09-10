"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isFlaggedDuplicate: boolean;
}

export function DuplicateFlagList({ users }: { users: UserRow[] }) {
  const [rows, setRows] = useState(users);

  async function toggle(userId: string, flagged: boolean) {
    setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, isFlaggedDuplicate: flagged } : u)));
    await fetch("/api/admin/flag-duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, flagged }),
    });
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
            <Switch checked={u.isFlaggedDuplicate} onCheckedChange={(v) => toggle(u.id, v)} />
          </div>
        </div>
      ))}
    </div>
  );
}

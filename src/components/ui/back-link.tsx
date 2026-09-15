"use client";

import { useRouter } from "next/navigation";

/**
 * Goes back to wherever the user actually came from (history, a league page, fixtures, home) —
 * a fixed destination link would guess wrong for at least one of those callers.
 */
export function BackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="text-sm text-muted-foreground hover:underline"
    >
      ← Back
    </button>
  );
}

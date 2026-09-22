"use client";

import { useEffect, useState } from "react";
import { PerfectXiTakeover } from "@/components/predict/perfect-xi-takeover";
import type { PerfectXiTakeoverPayload } from "@/lib/perfect-xi-payload";

/**
 * Automatically shows the Perfect XI celebration for an unseen Perfect XI — mounted from
 * (app)/layout.tsx, not triggered by a button. Marks the celebration seen at MOUNT time, not on
 * close: a killed tab can't reliably fire a close handler, so this is the safer point to record
 * "shown" and avoid re-showing it forever if the user never explicitly dismisses it.
 */
export function PerfectXiAutoTakeover({ payload }: { payload: PerfectXiTakeoverPayload }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch(`/api/predictions/${payload.predictionId}/celebration-seen`, { method: "POST" }).catch(() => {});
    // Only ever run once per mount of a given payload — re-firing on every render would still be
    // harmless (the route is idempotent), but there's no reason to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;
  return <PerfectXiTakeover {...payload} onClose={() => setOpen(false)} />;
}

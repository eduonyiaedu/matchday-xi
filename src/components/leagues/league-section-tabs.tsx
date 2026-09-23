"use client";

import { useState, type ReactNode } from "react";
import { UNDERLINE_TAB_BAR, underlineTabClass } from "@/components/ui/underline-tabs";

/** A private league's Fixtures/History switcher — same look as the Fixtures section's tabs. Both
 * panels are server-rendered up front, so switching is instant. */
export function LeagueSectionTabs({ fixtures, history }: { fixtures: ReactNode; history: ReactNode }) {
  const [active, setActive] = useState<"fixtures" | "history">("fixtures");
  const tabs = [
    { key: "fixtures", label: "Fixtures" },
    { key: "history", label: "History" },
  ] as const;

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className={UNDERLINE_TAB_BAR}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={underlineTabClass(active === tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{active === "fixtures" ? fixtures : history}</div>
    </div>
  );
}

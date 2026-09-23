const LINE = "border-white/22";

/**
 * Full landscape pitch markings for the home page's next-match hero: touchlines, halfway line,
 * centre circle + spot, and at each end the penalty area, six-yard box, penalty spot, penalty
 * arc, and corner arcs. The hero is much wider than a real pitch, so end markings use fixed pixel
 * sizes (in real-pitch proportion to the hero's ~120px height) rather than percentages, which
 * would stretch with the card's width.
 */
export function HeroPitchLines() {
  return (
    <div className={`absolute inset-3.5 overflow-hidden rounded-sm border ${LINE}`}>
      {/* Halfway line, centre circle, centre spot */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/22" />
      <div className={`absolute top-1/2 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border ${LINE}`} />
      <div className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />

      {(["left", "right"] as const).map((side) => {
        const edge = side === "left" ? "left-0" : "right-0";
        const openSide = side === "left" ? "border-l-0" : "border-r-0";
        return (
          <div key={side}>
            {/* Penalty area (16.5m deep) and six-yard box (5.5m deep) */}
            <div className={`absolute top-1/2 ${edge} h-[72px] w-8 -translate-y-1/2 border ${openSide} ${LINE}`} />
            <div className={`absolute top-1/2 ${edge} h-8 w-3 -translate-y-1/2 border ${openSide} ${LINE}`} />
            {/* Penalty spot, 11m out */}
            <div
              className={`absolute top-1/2 size-1 -translate-y-1/2 rounded-full bg-white/40 ${side === "left" ? "left-[21px]" : "right-[21px]"}`}
            />
            {/* Penalty arc: a circle round the spot, clipped to the part outside the box */}
            <div
              className={`absolute top-1/2 size-[42px] -translate-y-1/2 rounded-full border ${LINE} ${
                side === "left"
                  ? "left-[2px] [clip-path:inset(0_0_0_30px)]"
                  : "right-[2px] [clip-path:inset(0_30px_0_0)]"
              }`}
            />
            {/* Corner arcs — quarter circles, the rest clipped by the pitch outline */}
            <div className={`absolute top-0 ${edge} size-3 rounded-full border ${LINE} -translate-y-1/2 ${side === "left" ? "-translate-x-1/2" : "translate-x-1/2"}`} />
            <div className={`absolute bottom-0 ${edge} size-3 rounded-full border ${LINE} translate-y-1/2 ${side === "left" ? "-translate-x-1/2" : "translate-x-1/2"}`} />
          </div>
        );
      })}
    </div>
  );
}

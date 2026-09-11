/**
 * Generic team-colored jersey graphic — not real kit artwork (see lib/team-colors.ts for why).
 * Plain white and numberless when empty; team-colored with the player's shirt number when filled.
 */
export function Jersey({
  primary,
  secondary,
  number,
  empty,
}: {
  primary: string;
  secondary: string;
  number: number | null;
  empty: boolean;
}) {
  const body = empty ? "#FFFFFF" : primary;
  const trim = empty ? "#CBD5E1" : secondary;
  const numberColor = trim === "#FFFFFF" ? "#0F172A" : "#FFFFFF";

  return (
    <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden="true">
      {/* sleeves */}
      <path d="M10 10 L2 16 L6 22 L12 17 Z" fill={trim} stroke="#94A3B8" strokeWidth="0.5" />
      <path d="M30 10 L38 16 L34 22 L28 17 Z" fill={trim} stroke="#94A3B8" strokeWidth="0.5" />
      {/* torso */}
      <path
        d="M14 8 C14 8 16 11 20 11 C24 11 26 8 26 8 L30 12 L30 34 L10 34 L10 12 Z"
        fill={body}
        stroke="#94A3B8"
        strokeWidth="0.6"
      />
      {/* collar */}
      <path d="M16 8 C17.5 10.5 22.5 10.5 24 8" fill="none" stroke={trim} strokeWidth="1.4" />
      {!empty && number != null && (
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill={numberColor}
          fontFamily="system-ui, sans-serif"
        >
          {number}
        </text>
      )}
    </svg>
  );
}

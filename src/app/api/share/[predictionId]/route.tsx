import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getTeamColors } from "@/lib/team-colors";
import { tierFromPerfectXiCount } from "@/components/leaderboard/tier-disc";
import { FORMATION_LAYOUTS, type Formation } from "@/lib/formations";
import { loadOgFonts } from "@/lib/og-fonts";

export const runtime = "nodejs";

const CHALK = "#F5F3EC";
const MUTED = "#8A9A90";
const GOLD = "#F0B429";

const PREDICTION_INCLUDE = {
  user: { select: { displayName: true, username: true, perfectXiCount: true } },
  team: { select: { name: true, shortName: true, externalId: true } },
  fixture: {
    include: { homeTeam: { select: { name: true, shortName: true } }, awayTeam: { select: { name: true, shortName: true } } },
  },
  slots: { select: { slotIndex: true, isCorrect: true, squadPlayer: { select: { name: true, shirtNumber: true } } } },
  privateLeague: { select: { name: true } },
} satisfies Prisma.PredictionInclude;

type PredictionWithRelations = Prisma.PredictionGetPayload<{ include: typeof PREDICTION_INCLUDE }>;

// Deliberately unauthenticated — share images must be fetchable by external platforms (Twitter/
// Instagram link previews, a plain <img> tag) without session cookies. predictionId is a
// non-guessable UUID, and everything rendered here (name, username, club, fixture, XI) is exactly
// what the user chose to share by hitting the button, nothing more sensitive. A prediction only
// renders once it's locked (see the `locked` check below) — before that it's still editable, and
// sharing it early would let other members of a private league copy an unlocked pick.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ predictionId: string }> },
) {
  const { predictionId } = await params;
  const format = request.nextUrl.searchParams.get("format") === "story" ? "story" : "square";
  const width = 1080;
  const height = format === "story" ? 1920 : 1080;

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: PREDICTION_INCLUDE,
  });

  if (!prediction) {
    return new Response("Not found", { status: 404 });
  }

  const locked = new Date() >= prediction.fixture.lockAt;
  if (!locked) {
    return new Response("Not found", { status: 404 });
  }

  const colors = getTeamColors(prediction.team.externalId);
  const layout = FORMATION_LAYOUTS[(prediction.formation as Formation) ?? "4-4-2"] ?? FORMATION_LAYOUTS["4-4-2"];
  const slotByIndex = new Map(prediction.slots.map((s) => [s.slotIndex, s]));

  const scored = prediction.pointsAwarded !== null;
  const fonts = await loadOgFonts();

  return new ImageResponse(
    scored
      ? resultCard({ prediction, colors, layout, slotByIndex, format })
      : predictedLineupCard({ prediction, colors, layout, slotByIndex, format }),
    { width, height, fonts },
  );
}

// `children` must be a real array of siblings, not a `<>...</>` Fragment — satori doesn't flatten
// a Fragment passed as a single child through a function call, so a fragment here silently drops
// flex layout entirely (every "sibling" collapses onto one line instead of stacking in a column).
function baseFrame(format: "square" | "story", children: React.ReactNode[]) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: format === "story" ? "flex-start" : "center",
        backgroundColor: "#0B1F17",
        backgroundImage:
          "repeating-linear-gradient(90deg, #0E2A1F 0, #0E2A1F 60px, #103020 60px, #103020 120px)",
        padding: format === "story" ? "80px 60px" : "60px",
        fontFamily: "Inter",
        color: CHALK,
      }}
    >
      {children}
    </div>
  );
}

function header(initials: string, colors: { primary: string; secondary: string }, username: string) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.primary,
          color: colors.secondary,
          fontSize: 22,
          fontWeight: 700,
        }}
      >
        {initials}
      </div>
      <span style={{ fontSize: 24, letterSpacing: 4, color: CHALK }}>@{username.toUpperCase()}</span>
    </div>
  );
}

function leagueLabel(name: string) {
  return (
    <div
      key="league"
      style={{
        display: "flex",
        fontSize: 20,
        letterSpacing: 2,
        color: GOLD,
        marginTop: 14,
      }}
    >
      {`(PRIVATE LEAGUE: ${name.toUpperCase()})`}
    </div>
  );
}

function footer() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        paddingTop: 30,
        borderTop: "2px solid rgba(245,243,236,0.14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>MATCHDAY</span>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, color: GOLD }}>XI</span>
      </div>
      <span style={{ fontSize: 18, letterSpacing: 2, color: MUTED }}>MATCHDAY-XI.APP</span>
    </div>
  );
}

const LINE = "2px solid rgba(245,243,236,0.24)";
const SPOT = "rgba(245,243,236,0.45)";

// Marking sizes (px), in rough real-pitch proportion to the story card's ~900 x ~1000 pitch.
// "long" runs along the goal line, "depth" runs out from it.
const M = { circle: 180, boxLong: 420, boxDepth: 140, sixLong: 200, sixDepth: 54, spotDist: 94, arcRadius: 84, corner: 36 };

/**
 * Full pitch markings for the story card: touchlines, halfway line, centre circle + spot, and at
 * each end the penalty area, six-yard box, penalty spot, penalty arc (the part of the circle
 * round the spot that falls outside the box) and corner arcs. Everything is centred with fixed
 * marginLeft/marginTop offsets rather than `transform: translate(...)` — Satori's transform
 * support doesn't reliably match a browser's — and arcs are cut to shape with `overflow: hidden`
 * wrappers rather than clip-path, for the same reason. Children are laid out inside the touchline
 * box itself, whose own overflow clipping turns the corner circles into quarter arcs.
 */
function pitchMarkings() {
  const ends = ["top", "bottom"] as const;

  // Places an element against one goal line, centred along it, `offset` px out from the line.
  const atEnd = (end: "top" | "bottom", offset: number, long: number, depth: number): React.CSSProperties => ({
    left: "50%",
    marginLeft: -long / 2,
    width: long,
    height: depth,
    [end]: offset,
  });

  // Border on every side except the one lying on the goal line.
  const openBox = (end: "top" | "bottom"): React.CSSProperties => ({
    borderLeft: LINE,
    borderRight: LINE,
    ...(end === "top" ? { borderBottom: LINE } : { borderTop: LINE }),
  });

  const arcVisible = M.spotDist + M.arcRadius - M.boxDepth;
  const arcInset = M.spotDist - M.arcRadius - (M.boxDepth + 2);

  return (
    <div
      key="markings"
      style={{
        position: "absolute",
        top: 28,
        left: 28,
        right: 28,
        bottom: 28,
        display: "flex",
        overflow: "hidden",
        borderRadius: 6,
        border: LINE,
      }}
    >
      {/* Halfway line */}
      <div
        style={{ position: "absolute", top: "50%", marginTop: -1, left: 0, right: 0, height: 2, backgroundColor: "rgba(245,243,236,0.24)" }}
      />
      {/* Centre circle and spot */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          marginTop: -M.circle / 2,
          marginLeft: -M.circle / 2,
          width: M.circle,
          height: M.circle,
          borderRadius: 999,
          border: LINE,
        }}
      />
      <div
        style={{ position: "absolute", top: "50%", left: "50%", marginTop: -5, marginLeft: -5, width: 10, height: 10, borderRadius: 999, backgroundColor: SPOT }}
      />

      {ends.flatMap((end) => [
        // Penalty area and six-yard box
        <div key={`box-${end}`} style={{ position: "absolute", ...atEnd(end, 0, M.boxLong, M.boxDepth), ...openBox(end) }} />,
        <div key={`six-${end}`} style={{ position: "absolute", ...atEnd(end, 0, M.sixLong, M.sixDepth), ...openBox(end) }} />,
        // Penalty spot
        <div
          key={`spot-${end}`}
          style={{ position: "absolute", ...atEnd(end, M.spotDist - 4, 8, 8), borderRadius: 999, backgroundColor: SPOT }}
        />,
        // Penalty arc: a window just outside the box, showing only that slice of the spot's circle
        <div
          key={`arc-${end}`}
          style={{ position: "absolute", display: "flex", overflow: "hidden", ...atEnd(end, M.boxDepth + 2, M.arcRadius * 2, arcVisible) }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              [end]: arcInset,
              width: M.arcRadius * 2,
              height: M.arcRadius * 2,
              borderRadius: 999,
              border: LINE,
            }}
          />
        </div>,
      ])}

      {/* Corner arcs — circles centred on each corner, clipped to quarters by this box */}
      {(
        [
          { top: -M.corner / 2, left: -M.corner / 2 },
          { top: -M.corner / 2, right: -M.corner / 2 },
          { bottom: -M.corner / 2, left: -M.corner / 2 },
          { bottom: -M.corner / 2, right: -M.corner / 2 },
        ] as React.CSSProperties[]
      ).map((corner, i) => (
        <div
          key={`corner-${i}`}
          style={{ position: "absolute", ...corner, width: M.corner, height: M.corner, borderRadius: 999, border: LINE }}
        />
      ))}
    </div>
  );
}

interface DotStyle {
  number: string | number;
  name: string;
  fill: string;
  numberColor: string;
  nameColor: string;
}

/** The XI on a full pitch — the story card's diagram. */
function pitchDiagram({
  layout,
  dot,
}: {
  layout: { slotIndex: number; top: string; left: string }[];
  dot: (slotIndex: number) => DotStyle;
}) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        flex: 1,
        marginTop: 56,
        borderRadius: 24,
        backgroundColor: "rgba(0,0,0,0.16)",
        boxShadow: "inset 0 0 0 1.5px rgba(245,243,236,0.14)",
      }}
    >
      {pitchMarkings()}
      {layout.map((pos) => {
        const d = dot(pos.slotIndex);
        return (
          <div key={pos.slotIndex} style={{ position: "absolute", display: "flex", top: pos.top, left: pos.left }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginLeft: -65,
                marginTop: -46,
                width: 130,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: d.fill,
                  color: d.numberColor,
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {d.number}
              </div>
              <span
                style={{
                  display: "flex",
                  marginTop: 8,
                  fontSize: 19,
                  fontWeight: 600,
                  color: d.nameColor,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {d.name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The square card's layout — a compact list of the XI rather than a pitch (a founder decision,
 * reconfirmed 2026-09-23: square cards stay a plain list; only story cards get the pitch).
 */
function lineupList({
  layout,
  dot,
}: {
  layout: { slotIndex: number }[];
  dot: (slotIndex: number) => DotStyle;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", width: "100%", gap: 20, marginTop: 40 }}>
      {layout.map((pos) => {
        const d = dot(pos.slotIndex);
        return (
          <div key={pos.slotIndex} style={{ display: "flex", alignItems: "center", width: 320, height: 44 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  display: "flex",
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: d.fill,
                  fontSize: 14,
                  fontWeight: 700,
                  color: d.numberColor,
                }}
              >
                {d.number}
              </div>
              <span style={{ display: "flex", fontSize: 22, fontWeight: 600, color: d.nameColor }}>{d.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SlotMap = Map<number, PredictionWithRelations["slots"][number]>;

function surname(name: string | undefined) {
  return name ? name.split(" ").slice(-1)[0].toUpperCase() : "";
}

function resultCard({
  prediction,
  colors,
  layout,
  slotByIndex,
  format,
}: {
  prediction: PredictionWithRelations;
  colors: { primary: string; secondary: string };
  layout: { slotIndex: number; top: string; left: string }[];
  slotByIndex: SlotMap;
  format: "square" | "story";
}) {
  const tier = tierFromPerfectXiCount(prediction.user.perfectXiCount);
  const tierGradient =
    tier === "gold"
      ? "linear-gradient(145deg,#FFF0BE,#F7C63C 55%,#D99A12)"
      : tier === "silver"
        ? "linear-gradient(145deg,#E6E8E3,#9AA39C)"
        : "linear-gradient(145deg,#C6803F,#8C5122)";
  const scoreLabel =
    prediction.fixture.homeScore !== null && prediction.fixture.awayScore !== null
      ? `${prediction.fixture.homeTeam.shortName ?? prediction.fixture.homeTeam.name} ${prediction.fixture.homeScore}–${prediction.fixture.awayScore} ${prediction.fixture.awayTeam.shortName ?? prediction.fixture.awayTeam.name}`
      : `${prediction.fixture.homeTeam.shortName ?? prediction.fixture.homeTeam.name} vs ${prediction.fixture.awayTeam.shortName ?? prediction.fixture.awayTeam.name}`;
  const initials = (prediction.team.shortName ?? prediction.team.name).slice(0, 3).toUpperCase();
  const headline = prediction.isPerfectXi ? "PERFECT XI" : `+${prediction.pointsAwarded} PTS`;

  return baseFrame(format, [
    <div key="header" style={{ display: "flex" }}>
      {header(initials, colors, prediction.user.username)}
    </div>,

    prediction.privateLeagueId && prediction.privateLeague
      ? leagueLabel(prediction.privateLeague.name)
      : null,

    <div
      key="headline"
      style={{
        display: "flex",
        fontSize: format === "story" ? 96 : 108,
        fontWeight: 700,
        lineHeight: 0.95,
        textTransform: "uppercase",
        color: GOLD,
        marginTop: 48,
        textAlign: "center",
      }}
    >
      {headline}
    </div>,

    <div key="score" style={{ display: "flex", fontSize: 26, letterSpacing: 3, color: CHALK, marginTop: 24 }}>
      {scoreLabel.toUpperCase()}
    </div>,

    <div key="tier" style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 40 }}>
      <div style={{ width: 30, height: 30, borderRadius: 999, display: "flex", background: tierGradient }} />
      <span style={{ fontSize: 22, letterSpacing: 2, color: MUTED }}>
        {(tier ?? "no tier").toUpperCase()} · {prediction.user.perfectXiCount} PERFECT XI
      </span>
    </div>,

    <div key="diagram" style={{ display: "flex", width: "100%", flex: format === "story" ? 1 : 0 }}>
      {(format === "story" ? pitchDiagram : lineupList)({
        layout,
        dot: (slotIndex) => {
          const slot = slotByIndex.get(slotIndex);
          const correct = slot?.isCorrect === true;
          return {
            number: slot?.squadPlayer.shirtNumber ?? "",
            name: surname(slot?.squadPlayer.name),
            fill: correct ? GOLD : format === "story" ? "rgba(245,243,236,0.18)" : "rgba(245,243,236,0.14)",
            numberColor: correct ? "#0B1F17" : MUTED,
            nameColor: correct ? CHALK : MUTED,
          };
        },
      })}
    </div>,

    <div key="spacer" style={{ display: "flex", flex: format === "story" ? 0 : 1 }} />,

    <div key="footer" style={{ display: "flex", width: "100%" }}>
      {footer()}
    </div>,
  ]);
}

function predictedLineupCard({
  prediction,
  colors,
  layout,
  slotByIndex,
  format,
}: {
  prediction: PredictionWithRelations;
  colors: { primary: string; secondary: string };
  layout: { slotIndex: number; top: string; left: string }[];
  slotByIndex: SlotMap;
  format: "square" | "story";
}) {
  const isHome = prediction.fixture.homeTeamId === prediction.teamId;
  const opponent = isHome ? prediction.fixture.awayTeam : prediction.fixture.homeTeam;
  const matchLabel = `${isHome ? "VS" : "@"} ${(opponent.shortName ?? opponent.name).toUpperCase()}`;
  const kickoffLabel = prediction.fixture.kickoffAt
    .toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "")
    .toUpperCase();
  const initials = (prediction.team.shortName ?? prediction.team.name).slice(0, 3).toUpperCase();

  return baseFrame(format, [
    <div key="header" style={{ display: "flex" }}>
      {header(initials, colors, prediction.user.username)}
    </div>,

    prediction.privateLeagueId && prediction.privateLeague
      ? leagueLabel(prediction.privateLeague.name)
      : null,

    <div
      key="headline"
      style={{
        display: "flex",
        fontSize: 56,
        fontWeight: 700,
        lineHeight: 1,
        textTransform: "uppercase",
        color: GOLD,
        marginTop: 44,
        textAlign: "center",
      }}
    >
      My Predicted XI
    </div>,

    <div key="match" style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 2, color: CHALK, marginTop: 20 }}>
      {matchLabel}
    </div>,
    <div key="kickoff" style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: MUTED, marginTop: 8 }}>
      KICKOFF {kickoffLabel} GMT · {prediction.formation}
    </div>,

    <div key="diagram" style={{ display: "flex", width: "100%", flex: format === "story" ? 1 : 0 }}>
      {(format === "story" ? pitchDiagram : lineupList)({
        layout,
        dot: (slotIndex) => {
          const player = slotByIndex.get(slotIndex)?.squadPlayer;
          return {
            number: player?.shirtNumber ?? "",
            name: surname(player?.name),
            fill: colors.primary,
            numberColor: colors.secondary,
            nameColor: CHALK,
          };
        },
      })}
    </div>,

    <div key="spacer" style={{ display: "flex", flex: format === "story" ? 0 : 1 }} />,

    <div key="footer" style={{ display: "flex", width: "100%" }}>
      {footer()}
    </div>,
  ]);
}

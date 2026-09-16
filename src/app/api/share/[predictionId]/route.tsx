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

function pitchDiagram({
  layout,
  renderDot,
}: {
  layout: { slotIndex: number; top: string; left: string }[];
  renderDot: (slotIndex: number) => React.ReactNode;
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
      {layout.map((pos) => (
        <div
          key={pos.slotIndex}
          style={{
            position: "absolute",
            display: "flex",
            top: pos.top,
            left: pos.left,
          }}
        >
          {renderDot(pos.slotIndex)}
        </div>
      ))}
    </div>
  );
}

type SlotMap = Map<number, PredictionWithRelations["slots"][number]>;

/**
 * The square format has no room for the full pitch diagram, so the XI is shown as a compact
 * text list instead of being dropped entirely — "displayed" (the diagram) for the tall story
 * format, "listed" (this) for the square one, matching the two destinations they're meant for.
 */
function lineupList({
  layout,
  renderItem,
}: {
  layout: { slotIndex: number }[];
  renderItem: (slotIndex: number) => React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", width: "100%", gap: 16, marginTop: 40 }}>
      {layout.map((pos) => (
        <div key={pos.slotIndex} style={{ display: "flex", width: 290 }}>
          {renderItem(pos.slotIndex)}
        </div>
      ))}
    </div>
  );
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
      {format === "story"
        ? pitchDiagram({
            layout,
            renderDot: (slotIndex) => {
              const slot = slotByIndex.get(slotIndex);
              const player = slot?.squadPlayer;
              const correct = slot?.isCorrect === true;
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    marginLeft: -50,
                    marginTop: -34,
                    width: 100,
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: correct ? GOLD : "rgba(245,243,236,0.18)",
                      fontSize: 13,
                      fontWeight: 700,
                      color: correct ? "#0B1F17" : MUTED,
                    }}
                  >
                    {player?.shirtNumber ?? ""}
                  </div>
                  <span
                    style={{
                      display: "flex",
                      marginTop: 6,
                      fontSize: 15,
                      fontWeight: 600,
                      color: correct ? CHALK : MUTED,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {player ? player.name.split(" ").slice(-1)[0].toUpperCase() : ""}
                  </span>
                </div>
              );
            },
          })
        : lineupList({
            layout,
            renderItem: (slotIndex) => {
              const slot = slotByIndex.get(slotIndex);
              const player = slot?.squadPlayer;
              const correct = slot?.isCorrect === true;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: correct ? GOLD : "rgba(245,243,236,0.14)",
                      fontSize: 11,
                      fontWeight: 700,
                      color: correct ? "#0B1F17" : MUTED,
                    }}
                  >
                    {player?.shirtNumber ?? ""}
                  </div>
                  <span style={{ display: "flex", fontSize: 17, fontWeight: 600, color: correct ? CHALK : MUTED }}>
                    {player ? player.name.split(" ").slice(-1)[0].toUpperCase() : ""}
                  </span>
                </div>
              );
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
    .toUpperCase();
  const initials = (prediction.team.shortName ?? prediction.team.name).slice(0, 3).toUpperCase();

  return baseFrame(format, [
    <div key="header" style={{ display: "flex" }}>
      {header(initials, colors, prediction.user.username)}
    </div>,

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
      {format === "story"
        ? pitchDiagram({
            layout,
            renderDot: (slotIndex) => {
              const player = slotByIndex.get(slotIndex)?.squadPlayer;
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    marginLeft: -50,
                    marginTop: -34,
                    width: 100,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: colors.primary,
                      color: colors.secondary,
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    {player?.shirtNumber ?? ""}
                  </div>
                  <span
                    style={{
                      display: "flex",
                      marginTop: 6,
                      fontSize: 15,
                      fontWeight: 600,
                      color: CHALK,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {player ? player.name.split(" ").slice(-1)[0].toUpperCase() : ""}
                  </span>
                </div>
              );
            },
          })
        : lineupList({
            layout,
            renderItem: (slotIndex) => {
              const player = slotByIndex.get(slotIndex)?.squadPlayer;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: colors.primary,
                      color: colors.secondary,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {player?.shirtNumber ?? ""}
                  </div>
                  <span style={{ display: "flex", fontSize: 17, fontWeight: 600, color: CHALK }}>
                    {player ? player.name.split(" ").slice(-1)[0].toUpperCase() : ""}
                  </span>
                </div>
              );
            },
          })}
    </div>,

    <div key="spacer" style={{ display: "flex", flex: format === "story" ? 0 : 1 }} />,

    <div key="footer" style={{ display: "flex", width: "100%" }}>
      {footer()}
    </div>,
  ]);
}

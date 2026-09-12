import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { getTeamColors } from "@/lib/team-colors";
import { tierFromPerfectXiCount } from "@/components/leaderboard/tier-disc";
import { FORMATION_LAYOUTS, type Formation } from "@/lib/formations";

export const runtime = "nodejs";

// Deliberately unauthenticated — share images must be fetchable by external platforms (Twitter/
// Instagram link previews, a plain <img> tag) without session cookies. predictionId is a
// non-guessable UUID, and everything rendered here (name, username, club, fixture, score) is
// exactly what the user chose to share by hitting the button, nothing more sensitive.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ predictionId: string }> },
) {
  const { predictionId } = await params;
  const format = request.nextUrl.searchParams.get("format") === "story" ? "story" : "square";

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: {
      user: { select: { displayName: true, username: true, perfectXiCount: true } },
      team: { select: { name: true, shortName: true, externalId: true } },
      fixture: {
        include: { homeTeam: { select: { name: true, shortName: true } }, awayTeam: { select: { name: true, shortName: true } } },
      },
      slots: { select: { slotIndex: true, isCorrect: true } },
    },
  });

  if (!prediction || prediction.pointsAwarded === null) {
    return new Response("Not found", { status: 404 });
  }

  const colors = getTeamColors(prediction.team.externalId);
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

  const width = format === "story" ? 1080 : 1080;
  const height = format === "story" ? 1920 : 1080;

  return new ImageResponse(
    (
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
          fontFamily: "sans-serif",
          color: "#F5F3EC",
        }}
      >
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
          <span style={{ fontSize: 24, letterSpacing: 4, color: "#F5F3EC" }}>
            @{prediction.user.username.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: format === "story" ? 96 : 108,
            fontWeight: 700,
            lineHeight: 0.95,
            textTransform: "uppercase",
            color: prediction.isPerfectXi ? "#F0B429" : "#F5F3EC",
            marginTop: 48,
            textAlign: "center",
          }}
        >
          {headline}
        </div>

        <div style={{ display: "flex", fontSize: 26, letterSpacing: 3, color: "#F5F3EC", marginTop: 24 }}>
          {scoreLabel.toUpperCase()}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 40 }}>
          <div style={{ width: 30, height: 30, borderRadius: 999, display: "flex", background: tierGradient }} />
          <span style={{ fontSize: 22, letterSpacing: 2, color: "#8A9A90" }}>
            {(tier ?? "no tier").toUpperCase()} · {prediction.user.perfectXiCount} PERFECT XI
          </span>
        </div>

        {format === "story" && (
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
            {(FORMATION_LAYOUTS[(prediction.formation as Formation) ?? "4-4-2"] ?? FORMATION_LAYOUTS["4-4-2"]).map(
              (pos) => {
                const slot = prediction.slots.find((s) => s.slotIndex === pos.slotIndex);
                const correct = slot?.isCorrect === true;
                return (
                  <div
                    key={pos.slotIndex}
                    style={{
                      position: "absolute",
                      display: "flex",
                      top: pos.top,
                      left: pos.left,
                      width: 34,
                      height: 34,
                      marginLeft: -17,
                      marginTop: -17,
                      borderRadius: 999,
                      backgroundColor: correct ? "#F0B429" : "rgba(245,243,236,0.18)",
                    }}
                  />
                );
              },
            )}
          </div>
        )}

        <div style={{ display: "flex", flex: format === "story" ? 0 : 1 }} />

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
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, color: "#F0B429" }}>XI</span>
          </div>
          <span style={{ fontSize: 18, letterSpacing: 2, color: "#8A9A90" }}>MATCHDAY-XI.APP</span>
        </div>
      </div>
    ),
    { width, height },
  );
}

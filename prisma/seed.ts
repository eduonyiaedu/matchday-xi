/**
 * Local dev seed data — a handful of teams/players/fixtures with near-future kickoff times, so
 * the prediction builder, locking, and scoring pipeline can be exercised end-to-end without
 * burning real football-data.org/API-Football quota. Run with `npm run db:seed`.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const competition = await prisma.competition.upsert({
    where: { externalId: "PL" },
    update: {},
    create: { externalId: "PL", name: "Premier League" },
  });

  const arsenal = await prisma.team.upsert({
    where: { externalId: 9001 },
    update: {},
    create: { externalId: 9001, name: "Arsenal FC", shortName: "Arsenal", isPremierLeagueClub: true },
  });
  const chelsea = await prisma.team.upsert({
    where: { externalId: 9002 },
    update: {},
    create: { externalId: 9002, name: "Chelsea FC", shortName: "Chelsea", isPremierLeagueClub: true },
  });

  const arsenalSquad = [
    { id: 90001, name: "David Raya", position: "GOALKEEPER" as const },
    { id: 90002, name: "Ben White", position: "DEFENDER" as const },
    { id: 90003, name: "William Saliba", position: "DEFENDER" as const },
    { id: 90004, name: "Gabriel Magalhaes", position: "DEFENDER" as const },
    { id: 90005, name: "Jurrien Timber", position: "DEFENDER" as const },
    { id: 90006, name: "Declan Rice", position: "MIDFIELDER" as const },
    { id: 90007, name: "Martin Odegaard", position: "MIDFIELDER" as const },
    { id: 90008, name: "Mikel Merino", position: "MIDFIELDER" as const },
    { id: 90009, name: "Bukayo Saka", position: "FORWARD" as const },
    { id: 90010, name: "Gabriel Martinelli", position: "FORWARD" as const },
    { id: 90011, name: "Kai Havertz", position: "FORWARD" as const },
    { id: 90012, name: "Leandro Trossard", position: "FORWARD" as const },
  ];
  for (const p of arsenalSquad) {
    await prisma.squadPlayer.upsert({
      where: { footballDataId: p.id },
      update: {},
      create: { footballDataId: p.id, name: p.name, position: p.position, teamId: arsenal.id },
    });
  }

  const chelseaSquad = [
    { id: 90101, name: "Robert Sanchez", position: "GOALKEEPER" as const },
    { id: 90102, name: "Reece James", position: "DEFENDER" as const },
    { id: 90103, name: "Levi Colwill", position: "DEFENDER" as const },
    { id: 90104, name: "Wesley Fofana", position: "DEFENDER" as const },
    { id: 90105, name: "Marc Cucurella", position: "DEFENDER" as const },
    { id: 90106, name: "Moises Caicedo", position: "MIDFIELDER" as const },
    { id: 90107, name: "Enzo Fernandez", position: "MIDFIELDER" as const },
    { id: 90108, name: "Cole Palmer", position: "MIDFIELDER" as const },
    { id: 90109, name: "Nicolas Jackson", position: "FORWARD" as const },
    { id: 90110, name: "Noni Madueke", position: "FORWARD" as const },
    { id: 90111, name: "Pedro Neto", position: "FORWARD" as const },
    { id: 90112, name: "Christopher Nkunku", position: "FORWARD" as const },
  ];
  for (const p of chelseaSquad) {
    await prisma.squadPlayer.upsert({
      where: { footballDataId: p.id },
      update: {},
      create: { footballDataId: p.id, name: p.name, position: p.position, teamId: chelsea.id },
    });
  }

  // Kickoff 3 hours from now — still open (locks 2h before kickoff, i.e. 1h from now).
  const kickoffAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const lockAt = new Date(kickoffAt.getTime() - 2 * 60 * 60 * 1000);

  await prisma.fixture.upsert({
    where: { externalId: 800001 },
    update: {},
    create: {
      externalId: 800001,
      competitionId: competition.id,
      homeTeamId: arsenal.id,
      awayTeamId: chelsea.id,
      kickoffAt,
      lockAt,
      status: "SCHEDULED",
    },
  });

  console.log("Seed complete: Arsenal vs Chelsea, kickoff", kickoffAt.toISOString());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

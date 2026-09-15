import { z } from "zod";

export const FORMATIONS = ["4-4-2", "4-3-3", "4-2-3-1", "3-4-3"] as const;

export const predictionSlotSchema = z.object({
  slotIndex: z.number().int().min(0).max(10),
  squadPlayerId: z.string().uuid(),
});

export const submitPredictionSchema = z.object({
  fixtureId: z.string().uuid(),
  privateLeagueId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid(),
  formation: z.enum(FORMATIONS).default("4-4-2"),
  slots: z.array(predictionSlotSchema).length(11),
});

export type SubmitPredictionInput = z.infer<typeof submitPredictionSchema>;

export const changeTeamSchema = z.object({
  teamId: z.string().uuid(),
});

export const createPrivateLeagueSchema = z.object({
  name: z.string().min(3).max(60),
  teamRule: z.enum(["ANY_TEAM", "SINGLE_TEAM"]),
  // The creator's own permanent team choice for this league — required always, even for
  // ANY_TEAM, since it becomes their own membership row (see POST /api/leagues).
  teamId: z.string().uuid(),
  restrictedTeamId: z.string().uuid().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const joinLeagueSchema = z.object({
  // Optional because SINGLE_TEAM leagues derive it server-side from restrictedTeamId.
  teamId: z.string().uuid().optional(),
});

export const respondToMembershipSchema = z.object({
  membershipId: z.string().uuid(),
  approve: z.boolean(),
});

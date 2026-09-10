import { z } from "zod";

export const predictionSlotSchema = z.object({
  slotIndex: z.number().int().min(0).max(10),
  squadPlayerId: z.string().uuid(),
});

export const submitPredictionSchema = z.object({
  fixtureId: z.string().uuid(),
  privateLeagueId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid(),
  slots: z.array(predictionSlotSchema).length(11),
});

export type SubmitPredictionInput = z.infer<typeof submitPredictionSchema>;

export const changeTeamSchema = z.object({
  teamId: z.string().uuid(),
});

export const createPrivateLeagueSchema = z.object({
  name: z.string().min(3).max(60),
  teamRule: z.enum(["ANY_TEAM", "SINGLE_LEAGUE", "SINGLE_TEAM"]),
  restrictedTeamId: z.string().uuid().optional(),
  restrictedCompetitionId: z.string().uuid().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const respondToMembershipSchema = z.object({
  membershipId: z.string().uuid(),
  approve: z.boolean(),
});

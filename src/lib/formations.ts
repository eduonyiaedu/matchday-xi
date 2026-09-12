export const FORMATIONS = ["4-4-2", "4-3-3", "4-2-3-1", "3-4-3"] as const;
export type Formation = (typeof FORMATIONS)[number];

export interface SlotPosition {
  slotIndex: number;
  top: string;
  left: string;
}

// Purely visual layouts — slotIndex 0 is always GK; 1-10 are free-form outfield regardless of
// formation. Switching formations only redraws where each slotIndex is drawn on the pitch, it
// never reassigns which player occupies which slot, so scoring (player-identity only, see
// lib/scoring.ts) is completely unaffected by this choice.
export const FORMATION_LAYOUTS: Record<Formation, SlotPosition[]> = {
  "4-4-2": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "72%", left: "14%" },
    { slotIndex: 2, top: "72%", left: "38%" },
    { slotIndex: 3, top: "72%", left: "62%" },
    { slotIndex: 4, top: "72%", left: "86%" },
    { slotIndex: 5, top: "46%", left: "14%" },
    { slotIndex: 6, top: "46%", left: "38%" },
    { slotIndex: 7, top: "46%", left: "62%" },
    { slotIndex: 8, top: "46%", left: "86%" },
    { slotIndex: 9, top: "18%", left: "36%" },
    { slotIndex: 10, top: "18%", left: "64%" },
  ],
  "4-3-3": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "72%", left: "14%" },
    { slotIndex: 2, top: "72%", left: "38%" },
    { slotIndex: 3, top: "72%", left: "62%" },
    { slotIndex: 4, top: "72%", left: "86%" },
    { slotIndex: 5, top: "50%", left: "25%" },
    { slotIndex: 6, top: "50%", left: "50%" },
    { slotIndex: 7, top: "50%", left: "75%" },
    { slotIndex: 8, top: "20%", left: "20%" },
    { slotIndex: 9, top: "20%", left: "50%" },
    { slotIndex: 10, top: "20%", left: "80%" },
  ],
  "4-2-3-1": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "74%", left: "14%" },
    { slotIndex: 2, top: "74%", left: "38%" },
    { slotIndex: 3, top: "74%", left: "62%" },
    { slotIndex: 4, top: "74%", left: "86%" },
    { slotIndex: 5, top: "56%", left: "35%" },
    { slotIndex: 6, top: "56%", left: "65%" },
    { slotIndex: 7, top: "36%", left: "20%" },
    { slotIndex: 8, top: "36%", left: "50%" },
    { slotIndex: 9, top: "36%", left: "80%" },
    { slotIndex: 10, top: "16%", left: "50%" },
  ],
  "3-4-3": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "74%", left: "25%" },
    { slotIndex: 2, top: "74%", left: "50%" },
    { slotIndex: 3, top: "74%", left: "75%" },
    { slotIndex: 4, top: "50%", left: "14%" },
    { slotIndex: 5, top: "50%", left: "38%" },
    { slotIndex: 6, top: "50%", left: "62%" },
    { slotIndex: 7, top: "50%", left: "86%" },
    { slotIndex: 8, top: "20%", left: "20%" },
    { slotIndex: 9, top: "20%", left: "50%" },
    { slotIndex: 10, top: "20%", left: "80%" },
  ],
};

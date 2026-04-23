export interface AssistantContextPacket {
  user: {
    userId: string;
  };
  game: {
    editableGameweek: number | null;
    nextDeadline: string | null;
  };
  profile: {
    riskTolerance: number;
    budgetStyle: number;
    preferredFocus: number;
    differentialPreference: number;
    planningHorizon: number;
    explanationDepth: number;
    favoriteTeams: string[];
    notes: string | null;
  } | null;
  team: unknown;
  transfers: unknown;
  chips: unknown;
}
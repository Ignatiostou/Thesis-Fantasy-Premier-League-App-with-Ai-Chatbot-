export type ProjectionHorizon = 'GW1' | 'GW3' | 'GW5';
export type ProjectionSource   = 'ML' | 'HEURISTIC';



export interface PlayerProjection {
  playerId:         number;
  webName:          string;
  club:             string;
  position:         string;         // 'GK' | 'DEF' | 'MID' | 'FWD'
  nowCost:          number;         // tenths

  // Core projection values
  xPtsNextGw:       number;         // EXPECTED points next GW — includes the
                                    // chance he does not appear at all
  xPtsIfStarts?:    number;         // points if he does appear; equals
                                    // xPtsNextGw / chanceOfPlaying. Undefined
                                    // for predictions written before the
                                    // conditional model split.
  xPtsNext3Gw:      number;         // cumulative over next 3 GWs
  xPtsNext5Gw:      number;         // cumulative over next 5 GWs

  // Breakdown factors (shown to LLM for transparency)
  formScore:        number;         // 0-10 normalised
  fixtureScore:     number;         // 0-10 (10 = easiest run of fixtures)
  availabilityScore:number;         // 0-10 (chance of playing × availability)
  consistencyScore: number;         // 0-10 based on points per 90 minutes

  // Qualitative labels used in prompt
  outlook:          'excellent' | 'good' | 'average' | 'poor' | 'unknown';
  fixtureRun:       'easy' | 'mixed' | 'tough';
  confidence:       'HIGH' | 'MEDIUM' | 'LOW';  // how reliable the projection is
  source:            ProjectionSource; 
  
  // Raw inputs used in calculation (useful for debugging)
  form:             number;
  avgPts:           number;         // season average points per game
  chanceOfPlaying:  number;         // 0-100
  nextFixtureFdr:   number;         // 1-5
  avgFdrNext3:      number;
}

// ── Squad projection ──────────────────────────────────────────────────────────

export interface SquadProjection {
  gameweek:          number;
  totalXPtsNextGw:   number;        // sum of starting XI xPts (excl. bench)
  totalXPtsNext3Gw:  number;
  captainBonus:      number;        // extra pts from captain (best captain xPts × 1)
  projectedGwScore:  number;        // totalXPtsNextGw + captainBonus
  benchBuffer:       number;        // best bench player's xPts (auto-sub value)
  picks:             PlayerProjection[];
  topReturner:       PlayerProjection;   // highest xPts in XI
  weakestLink:       PlayerProjection;   // lowest xPts starter (transfer target)
  riskPlayers:       PlayerProjection[]; // chanceOfPlaying < 75 or status != 'a'
  mlCoverage:        number;
}

// ── Transfer delta projection ─────────────────────────────────────────────────

export interface TransferDelta {
  playerOut:         PlayerProjection;
  playerIn:          PlayerProjection;
  xPtsDeltaNextGw:   number;        // playerIn.xPtsNextGw - playerOut.xPtsNextGw
  xPtsDeltaNext3Gw:  number;
  netBenefitAfterHit:number;        // xPtsDeltaNextGw - hitCost (0 or 4)
  hitRequired:       boolean;
  hitCost:           number;        // 0 or 4
  verdict:           'UPGRADE' | 'SLIGHT_UPGRADE' | 'NEUTRAL' | 'DOWNGRADE';
  verdictReason:     string;
}

// ── Captain projection ────────────────────────────────────────────────────────

export interface CaptainProjection {
  gameweek:    number;
  candidates:  CaptainProjectionCandidate[];
  topPick:     CaptainProjectionCandidate;
  safePick:    CaptainProjectionCandidate;    // highest consistency/availability
  upside:      CaptainProjectionCandidate;    // highest ceiling (form × easy fixture)
}

export interface CaptainProjectionCandidate {
  playerId:          number;
  webName:           string;
  club:              string;
  position:          string;
  xPtsNextGw:        number;
  captainXPts:       number;    // xPtsNextGw × 2 (captain multiplier)
  fixtureRun:        string;    // e.g. "H vs MCI (FDR 2)"
  confidence:        'HIGH' | 'MEDIUM' | 'LOW';
  isSafePick:        boolean;
  isHighUpside:      boolean;
  isCurrentCaptain:  boolean;
  source:           ProjectionSource;
}


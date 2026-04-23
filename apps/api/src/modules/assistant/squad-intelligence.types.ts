

import type { PlayerProjection } from './projection.types.js';

// ── Formation ─────────────────────────────────────────────────────────────────

export type FormationCode =
  | '442' | '433' | '451' | '343' | '352'
  | '532' | '541';

export interface FormationSlot {
  position:   'GK' | 'DEF' | 'MID' | 'FWD';
  count:      number;
}

export interface FormationOption {
  code:              FormationCode;
  slots:             FormationSlot[];  // always [GK:1, DEF:x, MID:y, FWD:z]
  totalXPtsNextGw:   number;
  totalXPtsNext3Gw:  number;
  starters:          PlayerProjection[];
  bench:             PlayerProjection[];
  attackingScore:    number;    // 0-10: avg xPts of MID+FWD starters
  defensiveScore:    number;    // 0-10: avg xPts of GK+DEF starters
  balanceScore:      number;    // 0-10: how evenly pts are distributed
  feasible:          boolean;   // true if squad has enough players per position
  infeasibleReason?: string;
}

export interface FormationRecommendation {
  gameweek:          number;
  currentFormation:  FormationCode;
  currentXPts:       number;
  options:           FormationOption[];   // all feasible options, sorted by totalXPtsNextGw
  bestOption:        FormationOption;
  bestGain:          number;    // bestOption.totalXPtsNextGw - currentXPts
  reasoning:         string;
}

// ── Bench order ───────────────────────────────────────────────────────────────

export interface BenchSlot {
  order:          1 | 2 | 3 | 4;   // 1 = first auto-sub, 4 = last
  player:         PlayerProjection;
  autoSubValue:   number;           // xPts × chanceOfPlaying/100 × starterRisk
  reasoning:      string;
}

export interface BenchOrderRecommendation {
  gameweek:       number;
  currentOrder:   BenchSlot[];      // current DB bench order
  suggestedOrder: BenchSlot[];      // optimised order
  changed:        boolean;          // true if suggestion differs from current
  keyInsight:     string;           // most important thing to know about bench
}

// ── Lineup optimizer ──────────────────────────────────────────────────────────

export interface LineupOptimization {
  gameweek:          number;
  bestFormation:     FormationCode;
  bestXI:            PlayerProjection[];   // 11 players, sorted by position
  bench:             PlayerProjection[];   // 4 players, sorted by bench order
  totalXPtsNextGw:   number;
  captainSuggestion: PlayerProjection;
  vcSuggestion:      PlayerProjection;
  changesFromCurrent: LineupChange[];
  overallOutlook:    'excellent' | 'good' | 'average' | 'poor';
}

export interface LineupChange {
  type:      'START' | 'BENCH';  // player should START vs currently starting, or BENCH vs currently in XI
  player:    PlayerProjection;
  reason:    string;
}

// ── Weak links / upgrade targets ──────────────────────────────────────────────

export interface WeakLink {
  player:           PlayerProjection;
  rank:             number;          // 1 = most urgent to replace
  urgency:          'HIGH' | 'MEDIUM' | 'LOW';
  reasons:          string[];        // e.g. ['lowest xPts in XI', 'tough fixture run', 'injury risk']
  suggestedReplacements: UpgradeTarget[];
}

export interface UpgradeTarget {
  player:           PlayerProjection;
  xPtsDeltaNextGw:  number;         // how much better than current player
  xPtsDelta3Gw:     number;
  isAffordable:     boolean;
  budgetGap:        number;         // tenths: 0 = affordable, positive = how much short
  transferCost:     number;         // 0 = free transfer, 4 = hit
}

export interface WeakLinksAnalysis {
  gameweek:      number;
  weakLinks:     WeakLink[];        // top 3 weakest starters, ranked by urgency
  squadStrength: 'STRONG' | 'SOLID' | 'AVERAGE' | 'WEAK';
  squadSummary:  string;
}

// ── Full squad intelligence packet ───────────────────────────────────────────
// Everything bundled together for injection into the prompt

export interface SquadIntelligence {
  gameweek:          number;
  lineup:            LineupOptimization;
  formation:         FormationRecommendation;
  benchOrder:        BenchOrderRecommendation;
  weakLinks:         WeakLinksAnalysis;
}
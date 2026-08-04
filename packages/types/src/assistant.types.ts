// packages/types/assistant.types.ts

export type AssistantIntent =
  | 'GENERAL_HELP'
  | 'ONBOARDING'
  | 'INITIAL_SQUAD'
  | 'TRANSFER_ADVICE'
  | 'TRANSFER_EVALUATION'
  | 'CAPTAINCY'
  | 'BENCH_ORDER'
  | 'FORMATION_ADVICE'
  | 'CHIP_ADVICE'
  | 'PLAYER_COMPARISON';

export type AssistantSessionStatus = 'ACTIVE' | 'ARCHIVED';
export type AssistantMessageRole = 'SYSTEM' | 'USER' | 'ASSISTANT';


export const MAX_CHAT_MESSAGE_LENGTH = 2000;



export interface SessionListItem {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}



export interface AssistantProfileInput {
  riskTolerance: 1 | 2 | 3;
  budgetStyle: 1 | 2 | 3;
  preferredFocus: 1 | 2 | 3;
  differentialPreference: 1 | 2 | 3;
  planningHorizon: 1 | 2 | 3;
  explanationDepth: 1 | 2 | 3;


  topSixAffinity?: 1 | 2 | 3;
  captaincyStyle?: 1 | 2 | 3;
  transferFrequency?: 1 | 2 | 3;
  fixtureAwareness?: 1 | 2 | 3;

  favoriteTeams?: string[];
  notes?: string;
}

export interface AssistantProfileDto {
  id: string;
  userId: string;
  riskTolerance: number;
  budgetStyle: number;
  preferredFocus: number;
  differentialPreference: number;
  planningHorizon: number;
  explanationDepth: number;
  onboardingCompleted: boolean;
  onboardingStep: number;
  favoriteTeams: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantSessionDto {
  id: string;
  title: string | null;
  status: AssistantSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage?: {
    content: string;
    createdAt: string;
  } | null;
}

export interface AssistantMessageDto {
  id: string;
  role: AssistantMessageRole;
  content: string;
  createdAt: string;
}

export interface AssistantChatInput {
  message: string;
  sessionId?: string;
}

export interface AssistantChatResponse {
  sessionId: string;
  messageId: string;
  reply: string;
  role: 'assistant';
  createdAt: string;
}

export interface OnboardingOption {
  label: string;
  value: number;
}

export interface OnboardingQuestion {
  id: string;
  step: number;
  question: string;
  subtext?: string;
  options: OnboardingOption[];
}

export interface OnboardingStatusResponse {
  completed: boolean;
  step: number;
  hasProfile: boolean;
}

export interface SaveOnboardingStepInput {
  step: number;
  questionId: string;
  value: 1 | 2 | 3;
}

export interface CompleteOnboardingInput {
  riskTolerance: 1 | 2 | 3;
  budgetStyle: 1 | 2 | 3;
  preferredFocus: 1 | 2 | 3;
  differentialPreference: 1 | 2 | 3;
  planningHorizon: 1 | 2 | 3;
  explanationDepth: 1 | 2 | 3;
  topSixAffinity: 1 | 2 | 3;
  captaincyStyle: 1 | 2 | 3;
  transferFrequency: 1 | 2 | 3;
  fixtureAwareness: 1 | 2 | 3;
}


export type StreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'meta';    primarySource: 'ML' | 'HEURISTIC' | 'ML_ONLY' | 'HEURISTIC_ONLY'; reason: string }
  | { type: 'delta';   content:   string }
  | { type: 'done' }
  | { type: 'error';   message:   string };

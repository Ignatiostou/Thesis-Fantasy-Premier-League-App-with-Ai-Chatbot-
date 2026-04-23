# @fpl/types

Shared TypeScript types for the FPL monorepo. Used by both `apps/api` and `apps/web`.

## Structure

```
src/
├── index.ts          ← single export entry point
├── enums.ts          ← ChipType, LeagueType, PositionId, constants
├── fpl.types.ts      ← FplTeam, FplPlayer, FplEvent, FplFixture, PlayerGameweekStat
├── user.types.ts     ← User, PublicUser, RegisterBody, LoginBody, AuthResponse
├── team.types.ts     ← UserTeam, UserPick, UserTransfer, UserChip, SquadResponse
├── points.types.ts   ← UserGameweekScore, LiveGwResponse, SCORING_RULES
├── league.types.ts   ← League, StandingsResponse, H2HMatch
├── api.types.ts      ← ApiResponse<T>, ApiError, ApiErrorCode, JwtPayload
└── ai.types.ts       ← ChatMessage, ChatRequest, AiContext, AiSuggestion
```

## Setup

### 1. Reference the package in your app's `tsconfig.json`

**apps/api/tsconfig.json** and **apps/web/tsconfig.json** — add:
```json
{
  "compilerOptions": {
    "paths": {
      "@fpl/types": ["../../packages/types/src/index.ts"]
    }
  }
}
```

### 2. Add as a workspace dependency

**apps/api/package.json** and **apps/web/package.json**:
```json
{
  "dependencies": {
    "@fpl/types": "workspace:*"
  }
}
```

### 3. Import anywhere

```ts
// apps/api  — in a controller or service
import type { RegisterBody, ApiResponse, FplPlayer } from '@fpl/types';

// apps/web  — in a component or lib/api.ts
import type { AuthResponse, SquadResponse, ChipType } from '@fpl/types';
```

## Key conventions

| Convention | Example |
|---|---|
| Every API response is wrapped | `ApiResponse<SquadResponse>` |
| Dates are ISO strings on the wire | `"2024-08-16T11:00:00.000Z"` |
| Costs are stored in tenths of £m | `75` = £7.5m |
| Player positions are numeric IDs | `1`=GK `2`=DEF `3`=MID `4`=FWD |
| Enums are string const objects | `ChipType.WILDCARD` not `"wildcard"` |

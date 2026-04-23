
/** Every successful API response is wrapped in this shape */
export interface ApiResponse<T> {
  success: true;
  data:    T;
}

/** Every failed API response is wrapped in this shape */
export interface ApiError {
  success:  false;
  error:    string;       // human-readable message
  code?:    ApiErrorCode; // machine-readable code for the frontend to handle
  details?: unknown;      // validation details etc.
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ── Error codes ───────────────────────────────────────────────────────────────
// Used by the frontend to show the right error UI without parsing strings.

export type ApiErrorCode =
  // Auth
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOKEN_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'USERNAME_TAKEN'
  // Validation
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  // Squad / Team
  | 'BUDGET_EXCEEDED'
  | 'CLUB_LIMIT_EXCEEDED'
  | 'WRONG_SQUAD_SIZE'
  | 'DUPLICATE_PLAYER'
  | 'INVALID_CAPTAIN'
  | 'DEADLINE_PASSED'
  | 'CHIP_ALREADY_USED'
  // Leagues
  | 'LEAGUE_FULL'
  | 'ALREADY_IN_LEAGUE'
  | 'INVALID_LEAGUE_CODE'
  // Generic
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED';

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items:   T[];
  total:   number;
  page:    number;
  limit:   number;
  hasMore: boolean;
}

export interface PaginationQuery {
  page?:  number;
  limit?: number;
}

// ── Player search / list params ───────────────────────────────────────────────

export interface PlayerListQuery extends PaginationQuery {
  search?:   string;
  position?: number;    // 1-4
  teamId?:   number;
  maxCost?:  number;    // in tenths of £m
  minCost?:  number;
  sortBy?:   'totalPoints' | 'nowCost' | 'webName';
  sortDir?:  'asc' | 'desc';
}

// ── Fixture list params ───────────────────────────────────────────────────────

export interface FixtureListQuery {
  gameweek?: number;
  teamId?:   number;
}

// ── JWT payload (what's encoded in the access token) ─────────────────────────

export interface JwtPayload {
  sub:      string;   // userId
  email:    string;
  username: string;
  iat:      number;
  exp:      number;
}

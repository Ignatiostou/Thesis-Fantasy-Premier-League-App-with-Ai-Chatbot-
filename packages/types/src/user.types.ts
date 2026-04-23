export interface User {
  id:        string;
  email:     string;
  username:  string;
  createdAt: string;  // ISO date string
  updatedAt: string;
}

/** Safe public profile — returned from /auth/me and embedded in API responses */
export type PublicUser = Pick<User, 'id' | 'email' | 'username'>;

// ── Auth request / response bodies ───────────────────────────────────────────

export interface RegisterBody {
  email:    string;
  username: string;
  password: string;
}

export interface LoginBody {
  email:    string;
  password: string;
}

/** Returned by POST /auth/login and POST /auth/register */
export interface AuthResponse {
  user:        PublicUser;
  accessToken: string;   // JWT for authenticating future requests in the Authorization header
}

/** Returned by GET /auth/me */
export interface MeResponse {
  user: PublicUser;
}

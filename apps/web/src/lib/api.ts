const API = process.env.NEXT_PUBLIC_API_URL!;

type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string; data?: null };

let _refreshing: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (_refreshing) return _refreshing;
  _refreshing = fetch(`${API}/auth/refresh`, {
    method: 'POST', credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => { _refreshing = null; });
  return _refreshing;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  _retry = true,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
  });

  if (res.status === 401 && _retry) {
    const refreshed = await attemptRefresh();
    if (refreshed) return apiFetch<T>(path, init, false);
    if (typeof window !== 'undefined') window.location.href = '/auth';
    throw new Error('Session expired');
  }

  const json = await res.json().catch(() => ({}));

  if (typeof json?.success === 'boolean') {
    const env = json as ApiEnvelope<T>;
    if (!res.ok || !env.success) {
      const err = new Error((env as any).error ?? `Request failed (${res.status})`) as any;
      err.status = res.status;
      err.body   = json;
      throw err;
    }
    return env.data;
  }

  if (!res.ok) {
    const err = new Error(
      (json as any)?.errors?.[0] ?? (json as any)?.error ?? `Request failed (${res.status})`
    ) as any;
    err.status = res.status;
    err.body   = json;
    throw err;
  }

  return json as T;
}
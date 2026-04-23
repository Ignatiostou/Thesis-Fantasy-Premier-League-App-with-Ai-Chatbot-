export function setAuthCookies(res: any, access: string, refresh: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('access_token', access, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refresh, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookies(res: any) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}
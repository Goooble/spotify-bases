export const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() ?? '';
export const redirectUri =
  import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim() || `${location.origin}/callback`;
const tokenKey = `spotify-bases:tokens:${clientId}`;
const handshakeKey = `spotify-bases:pkce:${clientId}`;
type Tokens = { access_token: string; refresh_token: string; expiresAt: number; scope?: string };
export const requestedScopes =
  'user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private';
export const canEditLikedSongs = () =>
  !!readTokens()?.scope?.split(' ').includes('user-library-modify');
let refreshPromise: Promise<Tokens> | undefined;
let callbackPromise: Promise<boolean> | undefined;
let generation = 0;
export function configError(): string | undefined {
  if (!clientId) return 'Set VITE_SPOTIFY_CLIENT_ID in .env.local to connect your Spotify app.';
  try {
    const u = new URL(redirectUri);
    if (u.origin !== location.origin) return 'The redirect URI must use this app’s origin.';
    if (
      u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname))
    )
      return 'Use HTTPS or an explicit loopback IP for the redirect URI.';
  } catch {
    return 'The Spotify redirect URI is invalid.';
  }
}
export function readTokens(): Tokens | null {
  try {
    const t = JSON.parse(localStorage.getItem(tokenKey) ?? 'null');
    return t?.access_token && t?.refresh_token && Number.isFinite(t.expiresAt) ? t : null;
  } catch {
    return null;
  }
}
export function disconnect() {
  generation++;
  localStorage.removeItem(tokenKey);
  sessionStorage.removeItem(handshakeKey);
}
const base64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export async function connect() {
  const error = configError();
  if (error) throw new Error(error);
  const verifier = base64(crypto.getRandomValues(new Uint8Array(64)));
  const state = base64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  sessionStorage.setItem(handshakeKey, JSON.stringify({ verifier, state, created: Date.now() }));
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: requestedScopes,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}
async function exchange(params: URLSearchParams, previous?: Tokens): Promise<Tokens> {
  const version = generation;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) disconnect();
    throw new Error('Spotify authorization expired or was denied. Connect again.');
  }
  const data = await response.json();
  if (version !== generation) throw new Error('Connection was disconnected.');
  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? previous?.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? (previous ? previous.scope : requestedScopes),
  };
  localStorage.setItem(tokenKey, JSON.stringify(tokens));
  return tokens;
}
export function finishCallback(): Promise<boolean> {
  if (callbackPromise) return callbackPromise;
  const params = new URLSearchParams(location.search);
  let callbackPath: string;
  try {
    callbackPath = new URL(redirectUri).pathname;
  } catch {
    return Promise.reject(new Error('The Spotify redirect URI is invalid.'));
  }
  if (location.pathname !== callbackPath || (!params.has('code') && !params.has('error')))
    return Promise.resolve(false);
  callbackPromise = (async () => {
    const raw = sessionStorage.getItem(handshakeKey);
    sessionStorage.removeItem(handshakeKey);
    history.replaceState({}, '', '/');
    if (!raw) throw new Error('Missing authorization session. Connect again.');
    const handshake = JSON.parse(raw);
    if (params.get('state') !== handshake.state || Date.now() - handshake.created > 600000)
      throw new Error('Invalid or expired authorization state. Connect again.');
    if (params.has('error')) throw new Error('Spotify authorization was declined.');
    await exchange(
      new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: params.get('code')!,
        redirect_uri: redirectUri,
        code_verifier: handshake.verifier,
      }),
    );
    return true;
  })();
  return callbackPromise;
}
export async function accessToken(force = false): Promise<string> {
  const current = readTokens();
  if (!current) throw new Error('Connect Spotify to continue.');
  if (!force && current.expiresAt > Date.now() + 60000) return current.access_token;
  if (!refreshPromise)
    refreshPromise = exchange(
      new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: current.refresh_token,
      }),
      current,
    ).finally(() => {
      refreshPromise = undefined;
    });
  return (await refreshPromise).access_token;
}

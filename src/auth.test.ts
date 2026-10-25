import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'test');
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', {
    origin: 'http://127.0.0.1:5173',
    pathname: '/',
    search: '',
    assign: vi.fn(),
  });
  vi.stubGlobal('history', { replaceState: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('PKCE token lifecycle', () => {
  it('coalesces concurrent refresh and retains an unrotated refresh token', async () => {
    localStorage.setItem(
      'spotify-bases:tokens:test',
      JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 1 }),
    );
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })));
    vi.stubGlobal('fetch', transport);
    const { accessToken, readTokens } = await import('./auth');
    expect(await Promise.all([accessToken(), accessToken()])).toEqual(['new', 'new']);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(readTokens()?.refresh_token).toBe('refresh');
  });
  it('rejects callback state mismatch and removes callback credentials from URL', async () => {
    Object.assign(location, { pathname: '/callback', search: '?code=secret&state=wrong' });
    sessionStorage.setItem(
      'spotify-bases:pkce:test',
      JSON.stringify({ verifier: 'v', state: 'expected', created: Date.now() }),
    );
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const { finishCallback } = await import('./auth');
    await expect(finishCallback()).rejects.toThrow('Invalid');
    expect(transport).not.toHaveBeenCalled();
    expect(history.replaceState).toHaveBeenCalledWith({}, '', '/');
    expect(sessionStorage.getItem('spotify-bases:pkce:test')).toBeNull();
  });
  it('exchanges a valid callback only once under repeated initialization', async () => {
    Object.assign(location, { pathname: '/callback', search: '?code=code&state=expected' });
    sessionStorage.setItem(
      'spotify-bases:pkce:test',
      JSON.stringify({ verifier: 'verifier', state: 'expected', created: Date.now() }),
    );
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600 }),
        ),
      );
    vi.stubGlobal('fetch', transport);
    const { finishCallback } = await import('./auth');
    expect(await Promise.all([finishCallback(), finishCallback()])).toEqual([true, true]);
    expect(transport).toHaveBeenCalledTimes(1);
    const params = transport.mock.calls[0][1].body as URLSearchParams;
    expect(params.get('code_verifier')).toBe('verifier');
  });
  it('clears revoked tokens rather than looping refresh', async () => {
    localStorage.setItem(
      'spotify-bases:tokens:test',
      JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 1 }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    const { accessToken, readTokens } = await import('./auth');
    await expect(accessToken()).rejects.toThrow('Connect again');
    expect(readTokens()).toBeNull();
  });
  it('does not resurrect tokens if disconnect happens during refresh', async () => {
    localStorage.setItem(
      'spotify-bases:tokens:test',
      JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 1 }),
    );
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    const { accessToken, disconnect, readTokens } = await import('./auth');
    const pending = accessToken();
    disconnect();
    resolve(new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })));
    await expect(pending).rejects.toThrow('disconnected');
    expect(readTokens()).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { Spotify, ApiError } from './spotify';
import { RateLimitGate } from './rateLimit';
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
describe('Spotify transport', () => {
  it('accepts the empty HTTP 200 response used by library writes', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    await expect(
      new Spotify(async () => 'token', transport).request(
        'me/library?uris=spotify%3Atrack%3Aa',
        'PUT',
      ),
    ).resolves.toBeUndefined();
  });
  it('stops pagination after its source is deselected', async () => {
    const controller = new AbortController();
    const transport = vi
      .fn()
      .mockResolvedValue(json({ items: [1], next: 'https://api.spotify.com/v1/next' }));
    const api = new Spotify(async () => 'token', transport);
    await expect(
      api.pages('me/playlists', () => controller.abort(), controller.signal),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('paginates without losing items', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json({ items: [1, 2], next: 'https://api.spotify.com/v1/next' }))
      .mockResolvedValueOnce(json({ items: [3], next: null }));
    const api = new Spotify(async () => 'token', transport);
    expect(await api.pages('me/tracks')).toEqual([1, 2, 3]);
  });
  it('refreshes once on 401', async () => {
    const token = vi.fn().mockResolvedValue('token');
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ ok: true }));
    expect(await new Spotify(token, transport).request('me')).toEqual({ ok: true });
    expect(token).toHaveBeenCalledWith(true);
  });
  it('stops on 429 and blocks further requests until a manual retry after cooldown', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ ok: true }));
    const api = new Spotify(async () => 'token', transport);
    await expect(api.request('me')).rejects.toThrow('Retry-After: 2 seconds');
    await expect(api.request('me')).rejects.toMatchObject({ status: 429 });
    expect(transport).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000);
    try {
      expect(await api.request('me')).toEqual({ ok: true });
    } finally {
      clock.mockRestore();
    }
    const denied = vi.fn().mockResolvedValue(json({}, 403));
    await expect(new Spotify(async () => 'token', denied).request('me')).rejects.toMatchObject({
      status: 403,
    });
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it('persists quota cooldowns across client reloads without claiming an unknown reset time', async () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const transport = vi
      .fn()
      .mockResolvedValue(
        json({ error: { reason: 'QUOTA_EXCEEDED', message: 'Too many requests' } }, 429),
      );
    const first = new Spotify(async () => 'token', transport, new RateLimitGate(store));
    await expect(first.request('me')).rejects.toThrow('reset time is unknown');
    const reloaded = new Spotify(async () => 'token', transport, new RateLimitGate(store));
    await expect(reloaded.request('me/playlists')).rejects.toMatchObject({ status: 429 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(reloaded.rateLimit.read()?.reason).toBe('QUOTA_EXCEEDED');
  });
  it('retains a long server cooldown rather than replacing it with a shorter one', () => {
    const gate = new RateLimitGate();
    gate.record('/v1/me', json({}, 429, { 'Retry-After': '7200' }), null);
    const initial = gate.read()!.retryAt;
    gate.record('/v1/me', json({}, 429, { 'Retry-After': '1' }), null);
    expect(gate.read()?.retryAt).toBe(initial);
  });
  it('marks ambiguous writes without blindly retrying them', async () => {
    const transport = vi.fn().mockRejectedValue(new TypeError('network'));
    await expect(
      new Spotify(async () => 'token', transport).request('me/playlists', 'POST', { name: 'Test' }),
    ).rejects.toMatchObject({ uncertain: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects off-origin pagination before sending tokens', async () => {
    const token = vi.fn();
    await expect(new Spotify(token).pages('https://example.com/stolen')).rejects.toThrow(
      'Unexpected',
    );
    expect(token).not.toHaveBeenCalled();
  });
  it('discovers playlists without reading contents or saved tracks', async () => {
    const api = new Spotify();
    vi.spyOn(api, 'request').mockImplementation(async <T>(path: string) => {
      if (path === 'me') return { id: 'me' } as T;
      if (path.startsWith('me/playlists'))
        return {
          items: [{ id: 'p', name: 'Followed', owner: { id: 'other' }, collaborative: false }],
          next: null,
        } as T;
      if (path.startsWith('me/tracks')) throw new ApiError(500, 'Unavailable');
      throw new ApiError(403, 'Denied');
    });
    const result = await api.library(() => {});
    expect(result.playlists[0]).toMatchObject({ id: 'p', access: 'unloaded', editable: false });
    expect(result.savedLoaded).toBe(false);
    expect(result.refreshedAt).toBeTruthy();
    expect(api.request).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { LIKED_SONGS_ID, likedSongsPlaylist, normalize, type RawItem } from './model';
import { saveBatch, undoBatch, stage, type Drafts } from './batchEdits';
import { ApiError, Spotify } from './spotify';
const track = (id: string): RawItem => ({
  uri: `spotify:track:${id}`,
  type: 'track',
  name: id,
  duration_ms: 1000,
});
const source = (ids: string[]) =>
  likedSongsPlaylist(ids.map((id) => ({ track: track(id), added_at: '2020-01-01' })));
const row = (id: string) => normalize([], [source([id])])[0];
function apiWithLibrary(ids: string[]) {
  const api = new Spotify();
  const saved = new Set(ids.map((id) => track(id).uri));
  const request = vi
    .spyOn(api, 'request')
    .mockImplementation(async <T>(path: string, method = 'GET') => {
      const url = new URL(path, 'https://api.spotify.com/v1/'),
        uris = (url.searchParams.get('uris') ?? '').split(',');
      if (url.pathname.endsWith('/contains')) return uris.map((uri) => saved.has(uri)) as T;
      if (method === 'PUT') uris.forEach((uri) => saved.add(uri));
      else if (method === 'DELETE') uris.forEach((uri) => saved.delete(uri));
      return undefined as T;
    });
  return { api, saved, request };
}
describe('Liked Songs source', () => {
  it('normalizes saved-only songs as membership rows and deduplicates tracks', () => {
    const liked = source(['a', 'a', 'b']);
    expect(liked.occurrences).toHaveLength(2);
    const rows = normalize([], [liked]);
    expect(rows).toHaveLength(2);
    expect(rows[0].saved).toBe(true);
    expect(rows[0].memberships[LIKED_SONGS_ID]).toHaveLength(1);
  });
  it('saves 81 additions in library batches of at most 40 with query parameters', async () => {
    const { api, request, saved } = apiWithLibrary([]);
    let drafts: Drafts = {};
    const liked = source([]);
    for (let i = 0; i < 81; i++) drafts = stage(drafts, liked, row(String(i)), true);
    const result = await saveBatch(api, [liked], drafts);
    expect(result.remaining).toEqual({});
    expect(saved.size).toBe(81);
    expect(result.playlists[0].occurrences).toHaveLength(81);
    const writes = request.mock.calls.filter((call) => call[1] === 'PUT');
    expect(
      writes.map(
        (call) =>
          new URL(call[0], 'https://example.com/').searchParams.get('uris')!.split(',').length,
      ),
    ).toEqual([40, 40, 1]);
    expect(request.mock.calls.some((call) => call[0].startsWith('playlists/'))).toBe(false);
  });
  it('reconciles already-saved tracks without writing twice', async () => {
    const { api, request } = apiWithLibrary(['a']);
    const liked = source([]);
    const result = await saveBatch(api, [liked], stage({}, liked, row('a'), true));
    expect(result.remaining).toEqual({});
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.playlists[0].occurrences).toHaveLength(1);
    expect(normalize([], [result.playlists[0]])[0].saved).toBe(true);
  });
  it('supports Save and Undo for adding and removing liked tracks', async () => {
    const { api, saved } = apiWithLibrary(['a']);
    const liked = source(['a']);
    const result = await saveBatch(
      api,
      [liked],
      stage(stage({}, liked, row('a'), false), liked, row('b'), true),
    );
    expect([...saved]).toEqual(['spotify:track:b']);
    expect(result.undo).toBeDefined();
    const undone = await undoBatch(api, result.undo!, result.playlists);
    expect([...saved]).toEqual(['spotify:track:a']);
    expect(undone.undo).toBeUndefined();
    expect(undone.playlists[0].occurrences[0].addedAt).not.toBe('2020-01-01');
  });
  it('preserves drafts and reconciles uncertain library writes', async () => {
    const { api, request } = apiWithLibrary([]);
    const liked = source([]);
    request
      .mockResolvedValueOnce([false])
      .mockRejectedValueOnce(new ApiError(0, 'Lost', true))
      .mockResolvedValueOnce([true]);
    const result = await saveBatch(api, [liked], stage({}, liked, row('a'), true));
    expect(result.remaining).toEqual({});
    expect(result.undo).toBeUndefined();
    expect(result.playlists[0].occurrences).toHaveLength(1);
  });
  it('retains failed liked edits for retry', async () => {
    const { api, request } = apiWithLibrary(['a']);
    request.mockResolvedValueOnce([true]).mockRejectedValueOnce(new ApiError(403, 'Denied'));
    const liked = source(['a']);
    const result = await saveBatch(api, [liked], stage({}, liked, row('a'), false));
    expect(Object.keys(result.remaining)).toHaveLength(1);
    expect(result.errors[0]).toContain('Denied');
    expect(result.playlists[0].occurrences).toHaveLength(1);
  });
  it('does not stage episodes as liked tracks', () => {
    const liked = source([]);
    expect(
      stage({}, liked, { ...row('a'), type: 'episode', uri: 'spotify:episode:e' }, true),
    ).toEqual({});
  });
});

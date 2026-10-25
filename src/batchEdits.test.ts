import { describe, it, expect, vi } from 'vitest';
import { draftKey, stage, saveBatch, undoBatch, type Drafts, type SavedBatch } from './batchEdits';
import { normalize, type Playlist, type RawItem } from './model';
import { ApiError, Spotify } from './spotify';
const item = (id: string): RawItem => ({
  uri: `spotify:track:${id}`,
  name: id,
  type: 'track',
  duration_ms: 1000,
});
const playlist = (ids: string[] = [], snapshot = 'before'): Playlist => ({
  id: 'p',
  name: 'P',
  snapshot_id: snapshot,
  owner: { id: 'me' },
  collaborative: false,
  access: 'readable',
  editable: true,
  occurrences: ids.map((id, position) => ({
    uri: item(id).uri,
    item: item(id),
    position,
    addedAt: null,
  })),
});
const row = (id: string) => normalize([], [playlist([id])])[0];
describe('staged batch edits', () => {
  it('cancels a draft when toggled back without mutating confirmed membership', () => {
    const p = playlist(['a']);
    const drafts = stage({}, p, row('a'), false);
    expect(Object.keys(drafts)).toHaveLength(1);
    expect(p.occurrences).toHaveLength(1);
    expect(stage(drafts, p, row('a'), true)).toEqual({});
  });
  it('batches 205 additions in three writes and one snapshot check', async () => {
    const api = new Spotify();
    const request = vi.spyOn(api, 'request').mockResolvedValue({ snapshot_id: 'before' });
    const drafts: Drafts = Object.fromEntries(
      Array.from({ length: 205 }, (_, i) => [
        draftKey('p', row(String(i)).uri),
        { playlistId: 'p', uri: row(String(i)).uri, present: true, row: row(String(i)) },
      ]),
    );
    const result = await saveBatch(api, [playlist()], drafts);
    expect(request).toHaveBeenCalledTimes(4);
    expect(
      request.mock.calls
        .filter((c) => c[1] === 'POST')
        .map((c) => (c[2] as { uris: string[] }).uris.length),
    ).toEqual([100, 100, 5]);
    expect(result.remaining).toEqual({});
    expect(result.playlists[0].occurrences).toHaveLength(205);
    expect(result.undo?.changes[0].added).toHaveLength(205);
  });
  it('removes all occurrences of edited items while preserving other duplicates', async () => {
    const api = new Spotify();
    vi.spyOn(api, 'request').mockResolvedValue({ snapshot_id: 'before' });
    const p = playlist(['a', 'b', 'a', 'b']);
    const result = await saveBatch(api, [p], stage({}, p, row('a'), false));
    expect(result.playlists[0].occurrences.map((o) => o.uri)).toEqual([
      'spotify:track:b',
      'spotify:track:b',
    ]);
    expect(result.undo?.changes[0].removed.map((o) => o.position)).toEqual([0, 2]);
  });
  it('rebases remote changes and avoids a write when the desired membership is already present', async () => {
    const api = new Spotify();
    const request = vi.spyOn(api, 'request').mockResolvedValue({ snapshot_id: 'remote' });
    vi.spyOn(api, 'playlist').mockResolvedValue(playlist(['a'], 'remote'));
    const result = await saveBatch(api, [playlist()], stage({}, playlist(), row('a'), true));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.remaining).toEqual({});
    expect(result.undo).toBeUndefined();
  });
  it('retains only unapplied drafts after a batch fails', async () => {
    const api = new Spotify();
    vi.spyOn(api, 'request')
      .mockResolvedValueOnce({ snapshot_id: 'before' })
      .mockResolvedValueOnce({ snapshot_id: 'one' })
      .mockRejectedValueOnce(new ApiError(403, 'Denied'));
    const p = playlist(['a']);
    const drafts = stage(stage({}, p, row('a'), false), p, row('b'), true);
    const result = await saveBatch(api, [p], drafts);
    expect(Object.values(result.remaining).map((d) => d.uri)).toEqual(['spotify:track:b']);
    expect(result.undo?.changes[0].removed).toHaveLength(1);
    expect(result.playlists[0].occurrences).toHaveLength(0);
  });
  it('reconciles an uncertain write and withholds unsafe Undo', async () => {
    const api = new Spotify();
    const request = vi
      .spyOn(api, 'request')
      .mockResolvedValueOnce({ snapshot_id: 'before' })
      .mockRejectedValueOnce(new ApiError(0, 'Lost', true));
    vi.spyOn(api, 'playlist').mockResolvedValue(playlist(['a'], 'after'));
    const result = await saveBatch(api, [playlist()], stage({}, playlist(), row('a'), true));
    expect(result.remaining).toEqual({});
    expect(result.undo).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('restores duplicates at original positions and preserves untouched entries', async () => {
    const api = new Spotify();
    vi.spyOn(api, 'playlist').mockResolvedValue(playlist(['b'], 'after'));
    let snapshot = 'after';
    vi.spyOn(api, 'request').mockImplementation(async <T>(path: string, method?: string) => {
      if (method === 'POST') snapshot += '1';
      return { snapshot_id: snapshot } as T;
    });
    const before = playlist(['a', 'b', 'a']);
    const batch: SavedBatch = {
      expires: Date.now() + 15000,
      changes: [
        {
          playlistId: 'p',
          name: 'P',
          afterSnapshot: 'after',
          added: [],
          removed: before.occurrences.filter((o) => o.uri === 'spotify:track:a'),
          editable: true,
        },
      ],
    };
    const result = await undoBatch(api, batch, [playlist(['b'], 'after')]);
    expect(result.playlists[0].occurrences.map((o) => o.uri)).toEqual(
      before.occurrences.map((o) => o.uri),
    );
    expect(result.undo).toBeUndefined();
  });
  it('does not repeat a completed reversal after partial Undo failure', async () => {
    const api = new Spotify();
    const read = vi.spyOn(api, 'playlist').mockResolvedValueOnce(playlist(['b'], 'after'));
    const request = vi
      .spyOn(api, 'request')
      .mockResolvedValueOnce({ snapshot_id: 'after' })
      .mockResolvedValueOnce({ snapshot_id: 'step1' })
      .mockResolvedValueOnce({ snapshot_id: 'step1' })
      .mockRejectedValueOnce(new ApiError(403, 'Denied'));
    const before = playlist(['a', 'b', 'a']);
    const batch: SavedBatch = {
      expires: Date.now() + 15000,
      changes: [
        {
          playlistId: 'p',
          name: 'P',
          afterSnapshot: 'after',
          added: [],
          removed: before.occurrences.filter((o) => o.uri === 'spotify:track:a'),
          editable: true,
        },
      ],
    };
    const result = await undoBatch(api, batch, [playlist(['b'], 'after')]);
    expect(result.undo?.changes[0].removed.map((o) => o.position)).toEqual([2]);
    expect(result.undo?.changes[0].afterSnapshot).toBe('step1');
    read.mockResolvedValueOnce(result.playlists[0]);
    request
      .mockResolvedValueOnce({ snapshot_id: 'step1' })
      .mockResolvedValueOnce({ snapshot_id: 'done' });
    const retry = await undoBatch(api, result.undo!, result.playlists);
    expect(retry.playlists[0].occurrences.map((o) => o.uri)).toEqual(
      before.occurrences.map((o) => o.uri),
    );
  });
  it('refuses Undo against a changed remote snapshot', async () => {
    const api = new Spotify();
    vi.spyOn(api, 'playlist').mockResolvedValue(playlist(['a'], 'remote'));
    const request = vi.spyOn(api, 'request').mockResolvedValue({ snapshot_id: 'remote' });
    const result = await undoBatch(
      api,
      {
        expires: Date.now() + 15000,
        changes: [
          {
            playlistId: 'p',
            name: 'P',
            afterSnapshot: 'after',
            added: ['spotify:track:a'],
            removed: [],
            editable: true,
          },
        ],
      },
      [playlist(['a'], 'after')],
    );
    expect(result.errors[0]).toContain('changed');
    expect(request).not.toHaveBeenCalled();
    expect(result.undo).toBeUndefined();
  });
});

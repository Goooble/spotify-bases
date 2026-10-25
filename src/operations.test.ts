import { describe, it, expect, vi } from 'vitest';
import { continueCreation, type Creation } from './operations';
import { Spotify, ApiError } from './spotify';
import { type RawItem, type Playlist } from './model';
const item: RawItem = { uri: 'spotify:track:a', name: 'A', type: 'track', duration_ms: 1 };
const p = (count = 2, snapshot = 'before'): Playlist => ({
  id: 'p',
  name: 'P',
  owner: { id: 'me' },
  collaborative: false,
  snapshot_id: snapshot,
  access: 'readable',
  editable: true,
  occurrences: Array.from({ length: count }, (_, position) => ({
    uri: item.uri,
    item,
    position,
    addedAt: null,
  })),
});
describe('playlist creation', () => {
  it('creates an empty playlist without an add-items request', async () => {
    const api = new Spotify();
    const request = vi.spyOn(api, 'request').mockResolvedValue({ id: 'empty' });
    const result = await continueCreation(
      api,
      {
        uris: [],
        name: 'Empty',
        description: '',
        confirmed: 0,
        uncertain: false,
        complete: false,
      },
      () => {},
    );
    expect(result.complete).toBe(true);
    expect(result.confirmed).toBe(0);
    expect(request).toHaveBeenCalledExactlyOnceWith('me/playlists', 'POST', {
      name: 'Empty',
      description: '',
      public: true,
    });
  });
  it('retains confirmed batches and resumes an uncertain request from remote contents', async () => {
    const api = new Spotify();
    const uris = Array.from({ length: 205 }, (_, i) => `spotify:track:${i}`);
    const request = vi
      .spyOn(api, 'request')
      .mockResolvedValueOnce({ id: 'new' })
      .mockResolvedValueOnce({ snapshot_id: '1' })
      .mockRejectedValueOnce(new ApiError(0, 'Lost', true));
    let progress: Creation = {
      uris,
      name: 'Test',
      description: '',
      confirmed: 0,
      uncertain: false,
      complete: false,
    };
    await expect(
      continueCreation(api, progress, (next) => {
        progress = next;
      }),
    ).rejects.toThrow('Lost');
    expect(progress.confirmed).toBe(100);
    expect(progress.uncertain).toBe(true);
    vi.spyOn(api, 'playlist').mockResolvedValue({
      ...p(0),
      id: 'new',
      occurrences: uris
        .slice(0, 200)
        .map((uri, position) => ({ uri, position, item: { ...item, uri }, addedAt: null })),
    });
    request.mockResolvedValue({ snapshot_id: '2' });
    const result = await continueCreation(api, progress, () => {});
    expect(result.complete).toBe(true);
    expect(result.confirmed).toBe(205);
    expect(request).toHaveBeenLastCalledWith('playlists/new/items', 'POST', {
      uris: uris.slice(200),
    });
  });
});

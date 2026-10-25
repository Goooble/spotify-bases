import { describe, it, expect } from 'vitest';
import { normalize, type RawItem, type Playlist } from './model';
import { matches, query, pruneSelection, type Filter } from './filters';
export const track = (id = 'a', name = 'Track'): RawItem => ({
  uri: `spotify:track:${id}`,
  type: 'track',
  name,
  duration_ms: 180000,
  artists: [{ name: 'Artist' }],
  album: { name: 'Album' },
});
export const playlist = (items: RawItem[] = [track()]): Playlist => ({
  id: 'p',
  name: 'Playlist',
  owner: { id: 'me' },
  collaborative: false,
  snapshot_id: 's1',
  access: 'readable',
  editable: true,
  occurrences: items.map((item, position) => ({
    uri: item.uri,
    item,
    position,
    addedAt: '2025-01-01',
  })),
});
describe('library normalization', () => {
  it('unions saved-only items with playlists and retains duplicate occurrences', () => {
    const rows = normalize(
      [{ track: track('saved'), added_at: '2026-01-01' }],
      [playlist([track(), track(), track('b')])],
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.uri.endsWith(':a'))?.memberships.p).toHaveLength(2);
    expect(rows.find((r) => r.uri.endsWith(':saved'))?.savedAt).toBe('2026-01-01');
  });
  it('supports episodes and skips missing/local items', () => {
    const p = playlist([
      { ...track('local'), is_local: true },
      {
        ...track('episode'),
        uri: 'spotify:episode:e',
        type: 'episode',
        artists: undefined,
        album: undefined,
        show: { name: 'Show' },
      },
    ]);
    p.occurrences.push({ uri: null, item: null, position: 2, addedAt: null });
    expect(normalize([], [p])).toMatchObject([{ type: 'episode', album: 'Show' }]);
  });
});
describe('query engine', () => {
  it('unions selected playlists without duplicating shared tracks and combines with advanced filters', () => {
    const first = playlist([track('a', 'Alpha'), track('b', 'Beta')]);
    const second = { ...playlist([track('b', 'Beta'), track('c', 'Gamma')]), id: 'second' };
    const dataset = normalize(
      [{ track: track('saved', 'Saved only'), added_at: '2026-01-01' }],
      [first, second],
    );
    const empty: Filter = { kind: 'group', id: 'root', mode: 'all', children: [] };
    const sort = { field: 'title' as const, desc: false };
    expect(query(dataset, '', empty, sort, ['p']).map((r) => r.title)).toEqual(['Alpha', 'Beta']);
    expect(query(dataset, '', empty, sort, ['p', 'second']).map((r) => r.title)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(query(dataset, 'beta', empty, sort, ['p', 'second']).map((r) => r.title)).toEqual([
      'Beta',
    ]);
    expect(
      query(
        dataset,
        '',
        { kind: 'condition', id: 'a', field: 'album', op: 'is', value: 'Other' },
        sort,
        ['p', 'second'],
      ),
    ).toEqual([]);
    expect(query(dataset, '', empty, sort)).toHaveLength(4);
    expect(query(dataset, '', empty, sort, ['second']).map((r) => r.title)).toEqual([
      'Beta',
      'Gamma',
    ]);
  });
  const rows = normalize(
    [{ track: track('a', 'Zebra'), added_at: '2026-01-01' }],
    [playlist([track('a', 'Zebra'), track('b', 'Alpha')])],
  );
  const membership: Filter = {
    kind: 'condition',
    id: '1',
    field: 'playlist',
    op: 'is',
    value: 'p',
  };
  it('evaluates nested all/any/none groups', () => {
    const filter: Filter = {
      kind: 'group',
      id: 'root',
      mode: 'all',
      children: [
        membership,
        {
          kind: 'group',
          id: 'nested',
          mode: 'none',
          children: [{ kind: 'condition', id: '2', field: 'saved', op: 'is', value: 'true' }],
        },
      ],
    };
    expect(
      query(rows, 'artist', filter, { field: 'title', desc: false }).map((r) => r.title),
    ).toEqual(['Alpha']);
    expect(matches(rows[0], { kind: 'group', id: 'empty', mode: 'none', children: [] })).toBe(true);
  });
  it('keeps absent dates last in either sort direction', () => {
    for (const desc of [false, true])
      expect(
        query(
          rows,
          '',
          { kind: 'group', id: 'x', mode: 'all', children: [] },
          { field: 'savedAt', desc },
        )[0].savedAt,
      ).toBeTruthy();
  });
  it('uses inclusive date ranges and independent source dates', () => {
    expect(
      matches(rows[0], {
        kind: 'condition',
        id: 'd',
        field: 'savedAt',
        op: 'after',
        value: '2026-01-01',
      }),
    ).toBe(true);
    expect(
      matches(rows[1], {
        kind: 'condition',
        id: 'd',
        field: 'savedAt',
        op: 'after',
        value: '2025-01-01',
      }),
    ).toBe(false);
  });
  it('uses URI to break sort ties and prunes hidden selections', () => {
    const equal = rows.map((r) => ({ ...r, title: 'Same' })).reverse();
    expect(
      query(
        equal,
        '',
        { kind: 'group', id: 'x', mode: 'all', children: [] },
        { field: 'title', desc: false },
      )[0].uri,
    ).toBe('spotify:track:a');
    expect([...pruneSelection(new Set(rows.map((r) => r.uri)), [rows[1]])]).toEqual([
      'spotify:track:b',
    ]);
  });
  it('filters 20,000 rows with twenty memberships', () => {
    const large = Array.from({ length: 20000 }, (_, i) => ({
      ...rows[0],
      uri: `spotify:track:${i}`,
      memberships: Object.fromEntries(
        Array.from({ length: 20 }, (_, p) => [`p${p}`, rows[0].memberships.p]),
      ),
    }));
    expect(
      query(
        large,
        'artist',
        { kind: 'condition', id: 'p', field: 'playlist', op: 'is', value: 'p19' },
        { field: 'title', desc: false },
      ),
    ).toHaveLength(20000);
  });
});

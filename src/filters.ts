import type { LibraryItem, Sort } from './model';
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
export type Field =
  'playlist' | 'artist' | 'album' | 'savedAt' | 'saved' | 'type' | 'duration' | 'explicit';
export type Condition = {
  kind: 'condition';
  id: string;
  field: Field;
  op: 'is' | 'isNot' | 'contains' | 'after' | 'before' | 'greater' | 'less';
  value: string;
};
export type Filter =
  { kind: 'group'; id: string; mode: 'all' | 'any' | 'none'; children: Filter[] } | Condition;
export const group = (): Filter => ({
  kind: 'group',
  id: crypto.randomUUID(),
  mode: 'all',
  children: [],
});
export function matches(row: LibraryItem, f: Filter): boolean {
  if (f.kind === 'group') {
    if (!f.children.length) return true;
    const results = f.children.map((c) => matches(row, c));
    return f.mode === 'all'
      ? results.every(Boolean)
      : f.mode === 'any'
        ? results.some(Boolean)
        : !results.some(Boolean);
  }
  if (!f.value) return true;
  const val = f.value.toLocaleLowerCase();
  let result = false;
  switch (f.field) {
    case 'playlist':
      result = !!row.memberships[f.value]?.length;
      break;
    case 'saved':
      result = row.saved === (val === 'true');
      break;
    case 'explicit':
      result = row.explicit === (val === 'true');
      break;
    case 'type':
      result = row.type === val;
      break;
    case 'artist':
      result = row.artists.some((a) =>
        f.op === 'contains' ? a.toLocaleLowerCase().includes(val) : a.toLocaleLowerCase() === val,
      );
      break;
    case 'album':
      result =
        f.op === 'contains'
          ? row.album.toLocaleLowerCase().includes(val)
          : row.album.toLocaleLowerCase() === val;
      break;
    case 'savedAt':
      result =
        !!row.savedAt &&
        (f.op === 'after'
          ? row.savedAt.slice(0, 10) >= f.value
          : f.op === 'before'
            ? row.savedAt.slice(0, 10) <= f.value
            : row.savedAt.slice(0, 10) === f.value);
      break;
    case 'duration':
      result =
        f.op === 'greater' ? row.duration > Number(val) * 1000 : row.duration < Number(val) * 1000;
      break;
  }
  return f.op === 'isNot' ? !result : result;
}
export function query(
  rows: LibraryItem[],
  search: string,
  filter: Filter,
  sort: Sort,
  playlistIds: readonly string[] = [],
): LibraryItem[] {
  const needle = search.trim().toLocaleLowerCase();
  const result = rows.filter(
    (r) =>
      (!playlistIds.length || playlistIds.some((id) => !!r.memberships[id]?.length)) &&
      (!needle ||
        [r.title, ...r.artists, r.album].join(' ').toLocaleLowerCase().includes(needle)) &&
      matches(r, filter),
  );
  const value = (r: LibraryItem): string | number | null =>
    sort.field === 'title'
      ? r.title
      : sort.field === 'artist'
        ? r.artists.join(', ')
        : sort.field === 'album'
          ? r.album || null
          : sort.field === 'savedAt'
            ? r.savedAt
            : sort.playlist
              ? Number(!!r.memberships[sort.playlist]?.length)
              : 0;
  return result.sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : collator.compare(String(av ?? ''), String(bv ?? ''));
    return (sort.desc ? -cmp : cmp) || a.uri.localeCompare(b.uri);
  });
}
export function pruneSelection(selection: Set<string>, rows: LibraryItem[]): Set<string> {
  const visible = new Set(rows.map((r) => r.uri));
  return new Set([...selection].filter((uri) => visible.has(uri)));
}

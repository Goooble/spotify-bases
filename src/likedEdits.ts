import { LIKED_SONGS_ID, likedSongsPlaylist, type Occurrence, type Playlist } from './model';
import { ApiError, errorMessage, type Spotify } from './spotify';
import { rawFromRow } from './operations';
import type { Draft, SavedChange } from './batchEdits';
const query = (uris: string[]) => new URLSearchParams({ uris: uris.join(',') }).toString();
async function contains(api: Spotify, uris: string[]) {
  const result = await api.request<boolean[]>(`me/library/contains?${query(uris)}`);
  if (
    !Array.isArray(result) ||
    result.length !== uris.length ||
    result.some((value) => typeof value !== 'boolean')
  )
    throw new Error('Spotify returned invalid saved-track membership.');
  return result;
}
function updated(
  source: Playlist,
  entries: { uri: string; present: boolean; item: Occurrence['item']; addedAt: string | null }[],
): Playlist {
  const items = new Map(source.occurrences.map((o) => [o.uri, o]));
  for (const entry of entries)
    if (entry.present) {
      if (!items.has(entry.uri))
        items.set(entry.uri, {
          uri: entry.uri,
          item: entry.item,
          addedAt: entry.addedAt,
          position: 0,
        });
    } else items.delete(entry.uri);
  return {
    ...likedSongsPlaylist(
      [...items.values()].map((o) => ({ track: o.item, added_at: o.addedAt ?? '' })),
      source.owner.id,
      source.editable,
    ),
    reason: source.reason,
  };
}
export async function saveLikedEdits(api: Spotify, source: Playlist, drafts: Draft[]) {
  let working = source;
  const applied: string[] = [],
    errors: string[] = [];
  const change: SavedChange = {
    playlistId: LIKED_SONGS_ID,
    name: 'Liked Songs',
    afterSnapshot: source.snapshot_id,
    added: [],
    removed: [],
    editable: source.editable,
  };
  let undoSafe = true;
  try {
    if (drafts.some((d) => d.row.type !== 'track'))
      throw new Error('Liked Songs supports tracks only.');
    for (const present of [false, true]) {
      const list = drafts.filter((d) => d.present === present);
      for (let offset = 0; offset < list.length; offset += 40) {
        const batch = list.slice(offset, offset + 40),
          status = await contains(
            api,
            batch.map((d) => d.uri),
          );
        working = updated(
          working,
          batch.map((d, i) => ({
            uri: d.uri,
            present: status[i],
            item: rawFromRow(d.row),
            addedAt: null,
          })),
        );
        const needed = batch.filter((d, i) => {
          if (status[i] === present) {
            applied.push(d.uri);
            return false;
          }
          return true;
        });
        if (!needed.length) continue;
        const removed = working.occurrences.filter((o) => needed.some((d) => d.uri === o.uri));
        try {
          await api.request(
            `me/library?${query(needed.map((d) => d.uri))}`,
            present ? 'PUT' : 'DELETE',
          );
          working = updated(
            working,
            needed.map((d) => ({
              uri: d.uri,
              present,
              item: rawFromRow(d.row),
              addedAt: new Date().toISOString(),
            })),
          );
          applied.push(...needed.map((d) => d.uri));
          if (present) change.added.push(...needed.map((d) => d.uri));
          else change.removed.push(...removed);
        } catch (e) {
          if (e instanceof ApiError && e.uncertain) {
            undoSafe = false;
            try {
              const reconciled = await contains(
                api,
                needed.map((d) => d.uri),
              );
              working = updated(
                working,
                needed.map((d, i) => ({
                  uri: d.uri,
                  present: reconciled[i],
                  item: rawFromRow(d.row),
                  addedAt: new Date().toISOString(),
                })),
              );
              needed.forEach((d, i) => {
                if (reconciled[i] === present) applied.push(d.uri);
              });
            } catch {
              working = {
                ...working,
                access: 'failed',
                reason: 'Saved-track edit outcome is unknown. Retry Save to reconcile.',
              };
            }
          }
          throw e;
        }
      }
    }
  } catch (e) {
    errors.push(
      `Liked Songs: ${errorMessage(e)}${undoSafe ? '' : ' Undo is unavailable for uncertain changes.'}`,
    );
  }
  change.afterSnapshot = working.snapshot_id;
  return {
    playlist: working,
    applied,
    change: undoSafe && (change.added.length || change.removed.length) ? change : undefined,
    errors,
  };
}
export async function undoLikedEdits(api: Spotify, source: Playlist, original: SavedChange) {
  let working = source;
  const change = { ...original, added: [...original.added], removed: [...original.removed] };
  const errors: string[] = [];
  try {
    for (const present of [false, true]) {
      while (present ? change.removed.length : change.added.length) {
        const uris = present
          ? change.removed.slice(0, 40).map((o) => o.uri!)
          : change.added.slice(0, 40);
        const records = uris.map(
          (uri) =>
            change.removed.find((o) => o.uri === uri) ??
            working.occurrences.find((o) => o.uri === uri),
        );
        const status = await contains(api, uris);
        const needed = uris.filter((_, i) => status[i] !== present);
        if (needed.length)
          try {
            await api.request(`me/library?${query(needed)}`, present ? 'PUT' : 'DELETE');
          } catch (e) {
            if (!(e instanceof ApiError && e.uncertain)) throw e;
            const checked = await contains(api, uris);
            working = updated(
              working,
              uris.map((uri, i) => ({
                uri,
                present: checked[i],
                item: records[i]?.item ?? null,
                addedAt: new Date().toISOString(),
              })),
            );
            if (present)
              change.removed = change.removed.filter(
                (o) => !uris.some((uri, i) => uri === o.uri && checked[i] === present),
              );
            else
              change.added = change.added.filter(
                (uri) => !uris.some((candidate, i) => uri === candidate && checked[i] === present),
              );
            throw e;
          }
        working = updated(
          working,
          uris.map((uri, i) => ({
            uri,
            present,
            item: records[i]?.item ?? null,
            addedAt: new Date().toISOString(),
          })),
        );
        if (present) change.removed.splice(0, uris.length);
        else change.added.splice(0, uris.length);
      }
    }
  } catch (e) {
    errors.push(`Liked Songs: ${errorMessage(e)}`);
  }
  return {
    playlist: working,
    change: change.added.length || change.removed.length ? change : undefined,
    errors,
  };
}

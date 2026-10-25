import { LIKED_SONGS_ID, type LibraryItem, type Occurrence, type Playlist } from './model';
import { saveLikedEdits, undoLikedEdits } from './likedEdits';
import { ApiError, errorMessage, type Spotify } from './spotify';
import { rawFromRow } from './operations';
export type Draft = { playlistId: string; uri: string; present: boolean; row: LibraryItem };
export type Drafts = Record<string, Draft>;
export const draftKey = (playlistId: string, uri: string) => `${playlistId}|${uri}`;
export function stage(drafts: Drafts, p: Playlist, row: LibraryItem, present: boolean): Drafts {
  if (p.id === LIKED_SONGS_ID && row.type !== 'track') return drafts;
  const next = { ...drafts },
    key = draftKey(p.id, row.uri);
  if (!!p.occurrences.some((o) => o.uri === row.uri) === present) delete next[key];
  else next[key] = { playlistId: p.id, uri: row.uri, present, row };
  return next;
}
export type SavedChange = {
  playlistId: string;
  name: string;
  afterSnapshot: string;
  added: string[];
  removed: Occurrence[];
  editable: boolean;
  blocked?: boolean;
};
export type SavedBatch = { changes: SavedChange[]; expires: number };
const reindex = (entries: Occurrence[]) => entries.map((o, position) => ({ ...o, position }));
export async function saveBatch(api: Spotify, playlists: Playlist[], drafts: Drafts) {
  const remaining = { ...drafts },
    updated = new Map<string, Playlist>(),
    changes: SavedChange[] = [],
    errors: string[] = [];
  for (const id of new Set(Object.values(drafts).map((d) => d.playlistId))) {
    const original = playlists.find((p) => p.id === id);
    if (!original) {
      errors.push('An edited playlist is no longer available.');
      continue;
    }
    if (id === LIKED_SONGS_ID) {
      const result = await saveLikedEdits(
        api,
        original,
        Object.values(drafts).filter((d) => d.playlistId === id),
      );
      updated.set(id, result.playlist);
      result.applied.forEach((uri) => delete remaining[draftKey(id, uri)]);
      if (result.change) changes.push(result.change);
      errors.push(...result.errors);
      continue;
    }
    let working = { ...original, occurrences: [...original.occurrences] };
    const record: SavedChange = {
      playlistId: id,
      name: original.name,
      afterSnapshot: original.snapshot_id,
      added: [],
      removed: [],
      editable: original.editable,
    };
    let undoSafe = true;
    try {
      const metadata = await api.request<Playlist>(`playlists/${id}`);
      if (metadata.snapshot_id !== working.snapshot_id || working.access !== 'readable')
        working = { ...(await api.playlist(id)), editable: original.editable };
      const baseline = [...working.occurrences];
      const entries = Object.values(drafts).filter((d) => d.playlistId === id);
      const needed = entries.filter((d) => {
        if (working.occurrences.some((o) => o.uri === d.uri) === d.present) {
          delete remaining[draftKey(id, d.uri)];
          return false;
        }
        return true;
      });
      for (const present of [false, true]) {
        const list = needed.filter((d) => d.present === present);
        for (let offset = 0; offset < list.length; offset += 100) {
          const batch = list.slice(offset, offset + 100),
            uris = batch.map((d) => d.uri);
          try {
            const response = await api.request<{ snapshot_id: string }>(
              `playlists/${id}/items`,
              present ? 'POST' : 'DELETE',
              present
                ? { uris }
                : { items: uris.map((uri) => ({ uri })), snapshot_id: working.snapshot_id },
            );
            if (present) {
              record.added.push(...uris);
              working.occurrences.push(
                ...batch.map((d) => ({
                  uri: d.uri,
                  item: rawFromRow(d.row),
                  position: 0,
                  addedAt: new Date().toISOString(),
                })),
              );
            } else {
              record.removed.push(...baseline.filter((o) => !!o.uri && uris.includes(o.uri)));
              working.occurrences = working.occurrences.filter(
                (o) => !o.uri || !uris.includes(o.uri),
              );
            }
            working = {
              ...working,
              snapshot_id: response.snapshot_id,
              occurrences: reindex(working.occurrences),
            };
            record.afterSnapshot = response.snapshot_id;
            for (const d of batch) delete remaining[draftKey(id, d.uri)];
          } catch (error) {
            if (error instanceof ApiError && error.uncertain) {
              undoSafe = false;
              try {
                working = { ...(await api.playlist(id)), editable: original.editable };
                for (const d of batch)
                  if (working.occurrences.some((o) => o.uri === d.uri) === d.present)
                    delete remaining[draftKey(id, d.uri)];
              } catch {
                working = {
                  ...working,
                  access: 'failed',
                  reason: 'Save outcome is unknown. Retry Save to reconcile before writing.',
                };
              }
            }
            throw error;
          }
        }
      }
    } catch (error) {
      errors.push(
        `${original.name}: ${errorMessage(error)}${!undoSafe ? ' Undo is unavailable for this playlist because a write outcome was uncertain.' : ''}`,
      );
    }
    updated.set(id, working);
    if (undoSafe && (record.added.length || record.removed.length)) changes.push(record);
  }
  return {
    playlists: [...updated.values()],
    remaining,
    undo: changes.length ? { changes, expires: Date.now() + 15000 } : undefined,
    errors,
  };
}
const sameSequence = (a: Occurrence[], b: Occurrence[]) =>
  a.length === b.length && a.every((o, i) => o.uri === b[i].uri);
export async function undoBatch(api: Spotify, batch: SavedBatch, playlists: Playlist[]) {
  const updated: Playlist[] = [],
    remaining: SavedChange[] = [],
    errors: string[] = [];
  if (Date.now() > batch.expires)
    return { playlists: updated, undo: undefined, errors: ['Undo expired.'] };
  for (const original of batch.changes) {
    if (original.blocked) continue;
    const change = {
      ...original,
      added: [...original.added],
      removed: [...original.removed].sort((a, b) => a.position - b.position),
    };
    const cached = playlists.find((p) => p.id === change.playlistId);
    if (!cached) {
      errors.push(`${change.name}: Playlist is unavailable.`);
      continue;
    }
    if (change.playlistId === LIKED_SONGS_ID) {
      const result = await undoLikedEdits(api, cached, change);
      updated.push(result.playlist);
      if (result.change) remaining.push(result.change);
      errors.push(...result.errors);
      continue;
    }
    let working: Playlist = { ...cached };
    try {
      const remote = await api.playlist(change.playlistId);
      if (
        remote.snapshot_id !== change.afterSnapshot ||
        !sameSequence(remote.occurrences, working.occurrences)
      ) {
        change.blocked = true;
        throw new Error('Playlist changed since Save. Undo cancelled to preserve remote changes.');
      }
      working = { ...remote, editable: change.editable };
      while (change.added.length || change.removed.length) {
        const removing = change.added.length > 0;
        const uris = removing ? change.added.slice(0, 100) : [change.removed[0].uri!];
        const expected: Occurrence[] = removing
          ? reindex(working.occurrences.filter((o) => !o.uri || !uris.includes(o.uri)))
          : reindex([
              ...working.occurrences.slice(0, change.removed[0].position),
              change.removed[0],
              ...working.occurrences.slice(change.removed[0].position),
            ]);
        const check = await api.request<Playlist>(`playlists/${working.id}`);
        if (check.snapshot_id !== change.afterSnapshot) {
          change.blocked = true;
          throw new Error('Playlist changed during Undo. Remaining reversals cancelled.');
        }
        try {
          const result: { snapshot_id: string } = await api.request<{ snapshot_id: string }>(
            `playlists/${working.id}/items`,
            removing ? 'DELETE' : 'POST',
            removing
              ? { items: uris.map((uri) => ({ uri })), snapshot_id: change.afterSnapshot }
              : { uris, position: change.removed[0].position },
          );
          working = { ...working, occurrences: expected, snapshot_id: result.snapshot_id };
        } catch (error) {
          if (!(error instanceof ApiError && error.uncertain)) throw error;
          try {
            const fresh: Playlist = {
              ...(await api.playlist(working.id)),
              editable: change.editable,
            };
            if (sameSequence(fresh.occurrences, expected)) working = fresh;
            else if (
              fresh.snapshot_id === change.afterSnapshot &&
              sameSequence(fresh.occurrences, working.occurrences)
            )
              throw error;
            else {
              working = fresh;
              change.blocked = true;
              throw new Error(
                'Undo outcome conflicts with remote contents. Further reversals cancelled.',
              );
            }
          } catch (reconcileError) {
            if (reconcileError !== error) change.blocked = true;
            throw reconcileError;
          }
        }
        change.afterSnapshot = working.snapshot_id;
        if (removing) change.added.splice(0, uris.length);
        else change.removed.shift();
      }
    } catch (error) {
      errors.push(`${change.name}: ${errorMessage(error)}`);
      if (!change.blocked) remaining.push(change);
    }
    if (working) updated.push(working);
  }
  return {
    playlists: updated,
    undo: remaining.length ? { ...batch, changes: remaining } : undefined,
    errors,
  };
}

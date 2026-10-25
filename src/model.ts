export type RawItem = {
  uri: string;
  id?: string;
  type: 'track' | 'episode';
  name: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { name: string; images?: { url: string }[] };
  show?: { name: string; publisher?: string; images?: { url: string }[] };
  images?: { url: string }[];
  preview_url?: string | null;
  audio_preview_url?: string | null;
  external_urls?: { spotify: string };
  explicit?: boolean;
  is_local?: boolean;
};
export type Occurrence = {
  uri: string | null;
  position: number;
  addedAt: string | null;
  item: RawItem | null;
};
export type Playlist = {
  id: string;
  name: string;
  owner: { id: string; display_name?: string };
  collaborative: boolean;
  snapshot_id: string;
  external_urls?: { spotify: string };
  access: 'unloaded' | 'loading' | 'readable' | 'inaccessible' | 'failed';
  editable: boolean;
  reason?: string;
  occurrences: Occurrence[];
};
export type LibraryItem = {
  uri: string;
  type: 'track' | 'episode';
  title: string;
  artists: string[];
  album: string;
  duration: number;
  explicit: boolean;
  image?: string;
  preview?: string;
  url: string;
  savedAt: string | null;
  saved: boolean;
  memberships: Record<string, Occurrence[]>;
};
export type SavedTrack = { added_at: string; track: RawItem | null };
export type Library = {
  account: { id: string; account_id?: string; display_name?: string };
  playlists: Playlist[];
  saved: SavedTrack[];
  savedLoaded: boolean;
  errors: string[];
  refreshedAt?: string;
};
export type Folder = { id: string; name: string; playlists: string[]; collapsed: boolean };
export type Preferences = {
  version: 1;
  folders: Folder[];
  columns: string[];
  playlistOrder: string[];
  widths: Record<string, number>;
  search: string;
  sort: Sort;
  hidden: string[];
};
export type Sort = {
  field: 'title' | 'artist' | 'album' | 'savedAt' | 'membership';
  desc: boolean;
  playlist?: string;
};
export function normalize(saved: SavedTrack[], playlists: Playlist[]): LibraryItem[] {
  const rows = new Map<string, LibraryItem>();
  function insert(item: RawItem | null): LibraryItem | undefined {
    if (!item || item.is_local || !/^spotify:(track|episode):/.test(item.uri)) return;
    let row = rows.get(item.uri);
    if (!row) {
      row = {
        uri: item.uri,
        type: item.type,
        title: item.name,
        artists: item.artists?.map((a) => a.name) ?? [
          item.show?.publisher ?? item.show?.name ?? 'Unknown creator',
        ],
        album: item.album?.name ?? item.show?.name ?? '',
        duration: item.duration_ms,
        explicit: !!item.explicit,
        image: item.album?.images?.[0]?.url ?? item.images?.[0]?.url ?? item.show?.images?.[0]?.url,
        preview: item.preview_url ?? item.audio_preview_url ?? undefined,
        url:
          item.external_urls?.spotify ??
          `https://open.spotify.com/${item.type}/${item.uri.split(':')[2]}`,
        savedAt: null,
        saved: false,
        memberships: {},
      };
      rows.set(item.uri, row);
    }
    return row;
  }
  for (const entry of saved) {
    const row = insert(entry.track);
    if (row) {
      row.savedAt = entry.added_at || null;
      row.saved = true;
    }
  }
  for (const playlist of playlists)
    for (const entry of playlist.occurrences) {
      const row = insert(entry.item);
      if (row) {
        (row.memberships[playlist.id] ??= []).push(entry);
        if (playlist.id === LIKED_SONGS_ID) {
          row.saved = true;
          row.savedAt = entry.addedAt;
        }
      }
    }
  return [...rows.values()];
}
export const LIKED_SONGS_ID = 'liked-songs';
export function likedSongsPlaylist(
  saved: SavedTrack[],
  accountId = 'me',
  editable = true,
): Playlist {
  const entries = new Map<string, Occurrence>();
  for (const entry of saved) {
    const item = entry.track;
    if (!item || item.is_local || item.type !== 'track' || !item.uri.startsWith('spotify:track:'))
      continue;
    entries.set(item.uri, {
      uri: item.uri,
      item,
      position: entries.size,
      addedAt: entry.added_at || null,
    });
  }
  const occurrences = [...entries.values()].map((o, position) => ({ ...o, position }));
  return {
    id: LIKED_SONGS_ID,
    name: 'Liked Songs',
    owner: { id: accountId },
    collaborative: false,
    snapshot_id: JSON.stringify(
      occurrences
        .map((o) => [o.uri, o.addedAt])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
    external_urls: { spotify: 'https://open.spotify.com/collection/tracks' },
    access: 'readable',
    editable,
    reason: editable ? undefined : 'Reconnect Spotify to edit Liked Songs.',
    occurrences,
  };
}
export const defaultPreferences = (): Preferences => ({
  version: 1,
  folders: [],
  columns: [],
  playlistOrder: [],
  widths: {},
  search: '',
  sort: { field: 'title', desc: false },
  hidden: [],
});
export function loadPreferences(key: string): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (p?.version === 1 && Array.isArray(p.folders) && Array.isArray(p.columns)) {
      const candidate: Preferences = { ...defaultPreferences(), ...p };
      if (
        typeof candidate.search === 'string' &&
        candidate.sort &&
        ['title', 'artist', 'album', 'savedAt', 'membership'].includes(candidate.sort.field) &&
        typeof candidate.sort.desc === 'boolean' &&
        Array.isArray(candidate.hidden) &&
        candidate.hidden.every((v) => typeof v === 'string') &&
        candidate.columns.every((v) => typeof v === 'string') &&
        Array.isArray(candidate.playlistOrder) &&
        candidate.playlistOrder.every((v) => typeof v === 'string') &&
        candidate.widths &&
        typeof candidate.widths === 'object' &&
        Object.values(candidate.widths).every(
          (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
        ) &&
        candidate.folders.every(
          (f) =>
            f &&
            typeof f.id === 'string' &&
            typeof f.name === 'string' &&
            Array.isArray(f.playlists) &&
            f.playlists.every((v) => typeof v === 'string'),
        )
      )
        return candidate;
    }
  } catch {
    /* reset invalid local data */
  }
  return defaultPreferences();
}
export const preferenceKey = (client: string, user: string) =>
  `spotify-bases:preferences:${client}:${user}`;

export function orderedPlaylistIds(
  selected: readonly string[],
  remembered: readonly string[],
): string[] {
  const chosen = new Set(selected);
  return [...new Set([...remembered.filter((id) => chosen.has(id)), ...selected])];
}
export function movePlaylistColumn(
  selected: readonly string[],
  remembered: readonly string[],
  from: string,
  to: string,
): string[] {
  const visible = orderedPlaylistIds(selected, remembered),
    start = visible.indexOf(from),
    end = visible.indexOf(to);
  if (start < 0 || end < 0 || start === end) return [...remembered];
  visible.splice(start, 1);
  visible.splice(end, 0, from);
  const chosen = new Set(selected);
  let index = 0;
  return [...new Set([...remembered, ...selected])].map((id) =>
    chosen.has(id) ? visible[index++] : id,
  );
}

import { ApiError, type Spotify } from './spotify';
import type { LibraryItem } from './model';
export function rawFromRow(row: LibraryItem) {
  return {
    uri: row.uri,
    type: row.type,
    name: row.title,
    duration_ms: row.duration,
    artists: row.artists.map((name) => ({ name })),
    album:
      row.type === 'track'
        ? { name: row.album, images: row.image ? [{ url: row.image }] : [] }
        : undefined,
    show: row.type === 'episode' ? { name: row.album, publisher: row.artists[0] } : undefined,
    preview_url: row.preview,
    external_urls: { spotify: row.url },
    explicit: row.explicit,
  };
}
export type Creation = {
  uris: string[];
  name: string;
  description: string;
  playlist?: { id: string; external_urls?: { spotify: string } };
  confirmed: number;
  uncertain: boolean;
  complete: boolean;
};
export async function continueCreation(
  api: Spotify,
  job: Creation,
  onProgress: (job: Creation) => void,
): Promise<Creation> {
  const current = { ...job };
  const publish = () => onProgress({ ...current });
  if (!current.playlist) {
    if (current.uncertain)
      throw new Error(
        'Playlist creation outcome is unknown. Check Spotify before creating another playlist.',
      );
    try {
      current.playlist = await api.request('me/playlists', 'POST', {
        name: current.name.trim(),
        description: current.description,
        public: true,
      });
      publish();
    } catch (error) {
      current.uncertain = error instanceof ApiError && error.uncertain;
      publish();
      throw error;
    }
  }
  const playlist = current.playlist!;
  if (job.playlist) {
    const fresh = await api.playlist(playlist.id);
    const actual = fresh.occurrences.map((o) => o.uri);
    if (
      actual.length > current.uris.length ||
      actual.some((uri, index) => uri !== current.uris[index])
    )
      throw new Error(
        'The playlist changed outside this operation. Resume cancelled; inspect it in Spotify.',
      );
    current.confirmed = actual.length;
    current.uncertain = false;
    publish();
  }
  while (current.confirmed < current.uris.length) {
    const batch = current.uris.slice(current.confirmed, current.confirmed + 100);
    try {
      await api.request(`playlists/${playlist.id}/items`, 'POST', { uris: batch });
      current.confirmed += batch.length;
      publish();
    } catch (error) {
      current.uncertain = error instanceof ApiError && error.uncertain;
      publish();
      throw error;
    }
  }
  current.complete = true;
  publish();
  return current;
}

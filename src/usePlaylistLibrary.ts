import { useCallback, useEffect, useRef, useState } from 'react';
import { LIKED_SONGS_ID, likedSongsPlaylist, type Library, type Playlist } from './model';
import { canEditLikedSongs } from './auth';
import { ApiError, errorMessage, spotify } from './spotify';
export function usePlaylistLibrary(
  ready: boolean,
  ids: string[],
  onAccount: (account: Library['account']) => void,
) {
  const [library, setLibrary] = useState<Library>();
  const [refreshing, setRefreshing] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const state = useRef(library);
  state.current = library;
  const selection = useRef(ids);
  selection.current = ids;
  const requests = useRef(new Map<string, AbortController>());
  const version = useRef(0);
  const refreshLock = useRef(false);
  const metadataLock = useRef(false);
  const metadataController = useRef<AbortController | undefined>(undefined);
  const loadMetadata = useCallback(async (force = false) => {
    const current = state.current;
    if (
      metadataLock.current ||
      !current ||
      (!force &&
        current.savedLoaded &&
        current.playlists.find((p) => p.id === LIKED_SONGS_ID)?.access === 'readable')
    )
      return;
    const controller = new AbortController();
    metadataController.current = controller;
    const generation = version.current;
    metadataLock.current = true;
    setMetadataLoading(true);
    setError('');
    setLibrary((current) =>
      current
        ? {
            ...current,
            playlists: current.playlists.map((p) =>
              p.id === LIKED_SONGS_ID ? { ...p, access: 'loading', reason: undefined } : p,
            ),
          }
        : current,
    );
    try {
      const source = await spotify.playlist(LIKED_SONGS_ID, controller.signal);
      if (generation === version.current && !controller.signal.aborted) {
        const editable = canEditLikedSongs();
        const liked = {
          ...source,
          owner: { id: current.account.id },
          editable,
          reason: editable ? undefined : 'Reconnect Spotify to edit Liked Songs.',
        };
        setLibrary((current) =>
          current
            ? {
                ...current,
                saved: liked.occurrences
                  .filter((o) => o.item)
                  .map((o) => ({ track: o.item, added_at: o.addedAt ?? '' })),
                savedLoaded: true,
                playlists: current.playlists.map((p) => (p.id === LIKED_SONGS_ID ? liked : p)),
              }
            : current,
        );
        setStatus('Playlist list ready · Liked Songs and metadata loaded');
      }
    } catch (e) {
      if (generation === version.current && !controller.signal.aborted) {
        setError(`Liked Songs: ${errorMessage(e)}`);
        setLibrary((current) =>
          current
            ? {
                ...current,
                playlists: current.playlists.map((p) =>
                  p.id === LIKED_SONGS_ID ? { ...p, access: 'failed', reason: errorMessage(e) } : p,
                ),
              }
            : current,
        );
      }
    } finally {
      if (metadataController.current === controller) {
        metadataLock.current = false;
        setMetadataLoading(false);
        metadataController.current = undefined;
      }
    }
  }, []);
  const load = useCallback(
    async (id: string) => {
      if (id === LIKED_SONGS_ID) {
        await loadMetadata();
        return;
      }
      const original = state.current?.playlists.find((p) => p.id === id);
      if (
        !original ||
        requests.current.has(id) ||
        original.access === 'readable' ||
        original.access === 'inaccessible'
      )
        return;
      const controller = new AbortController(),
        generation = version.current;
      requests.current.set(id, controller);
      setLibrary((current) =>
        current
          ? {
              ...current,
              playlists: current.playlists.map((p) =>
                p.id === id ? { ...p, access: 'loading', reason: undefined } : p,
              ),
            }
          : current,
      );
      try {
        const p = await spotify.playlist(id, controller.signal);
        if (generation === version.current && !controller.signal.aborted) {
          setLibrary((current) =>
            current
              ? {
                  ...current,
                  playlists: current.playlists.map((old) =>
                    old.id === id ? { ...p, editable: original.editable } : old,
                  ),
                }
              : current,
          );
          setStatus(`Loaded ${p.name}`);
        }
      } catch (e) {
        if (generation === version.current && !controller.signal.aborted) {
          const inaccessible = e instanceof ApiError && (e.status === 403 || e.status === 404);
          setLibrary((current) =>
            current
              ? {
                  ...current,
                  playlists: current.playlists.map((p) =>
                    p.id === id
                      ? {
                          ...p,
                          access: inaccessible ? 'inaccessible' : 'failed',
                          reason: inaccessible
                            ? 'Spotify does not expose this playlist’s contents to this app.'
                            : errorMessage(e),
                        }
                      : p,
                  ),
                }
              : current,
          );
          setError(`${original.name}: ${errorMessage(e)}`);
        }
      } finally {
        if (requests.current.get(id) === controller) requests.current.delete(id);
      }
    },
    [loadMetadata],
  );
  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    setError('');
    version.current++;
    requests.current.forEach((c) => c.abort());
    requests.current.clear();
    const generation = version.current;
    try {
      const discovered = await spotify.library(() => {});
      if (generation !== version.current) return;
      const old = state.current,
        same =
          old &&
          (old.account.account_id ?? old.account.id) ===
            (discovered.account.account_id ?? discovered.account.id);
      onAccount(discovered.account);
      setMetadataLoading(true);
      const playlists = discovered.playlists.map((p) => {
        const cached = same ? old.playlists.find((c) => c.id === p.id) : undefined;
        return cached &&
          cached.access === 'readable' &&
          cached.snapshot_id === p.snapshot_id &&
          !selection.current.includes(p.id)
          ? { ...p, access: 'readable' as const, occurrences: cached.occurrences }
          : p;
      });
      setLibrary({
        ...discovered,
        playlists: [
          {
            ...likedSongsPlaylist([], discovered.account.id, canEditLikedSongs()),
            access: 'unloaded',
          },
          ...playlists,
        ],
        saved: same ? old.saved : [],
        savedLoaded: same ? old.savedLoaded : false,
      });
      setStatus('Playlist list ready');
    } catch (e) {
      if (generation === version.current) setError(errorMessage(e));
    } finally {
      refreshLock.current = false;
      if (generation === version.current) setRefreshing(false);
    }
  }, [onAccount]);
  useEffect(() => {
    if (ready) void refresh();
    else {
      version.current++;
      metadataController.current?.abort();
      requests.current.forEach((c) => c.abort());
      requests.current.clear();
      setLibrary(undefined);
    }
  }, [ready, refresh]);
  useEffect(() => {
    if (refreshing) return;
    for (const [id, controller] of requests.current)
      if (!ids.includes(id)) {
        controller.abort();
        requests.current.delete(id);
        setLibrary((current) =>
          current
            ? {
                ...current,
                playlists: current.playlists.map((p) =>
                  p.id === id && p.access === 'loading' ? { ...p, access: 'unloaded' } : p,
                ),
              }
            : current,
        );
      }
    for (const p of library?.playlists ?? [])
      if (ids.includes(p.id) && p.access === 'unloaded') void load(p.id);
  }, [ids, library, refreshing, load]);
  useEffect(() => {
    if (
      !refreshing &&
      library?.playlists.find((p) => p.id === LIKED_SONGS_ID)?.access === 'unloaded'
    )
      void loadMetadata(true);
  }, [library, refreshing, loadMetadata]);
  useEffect(
    () => () => {
      version.current++;
      metadataController.current?.abort();
      requests.current.forEach((c) => c.abort());
      requests.current.clear();
    },
    [],
  );
  const replace = useCallback(
    (playlists: Playlist[]) =>
      setLibrary((current) => {
        if (!current) return current;
        const liked = playlists.find((p) => p.id === LIKED_SONGS_ID);
        return {
          ...current,
          playlists: current.playlists.map((p) => playlists.find((next) => next.id === p.id) ?? p),
          ...(liked
            ? {
                saved: liked.occurrences
                  .filter((o) => o.item)
                  .map((o) => ({ track: o.item, added_at: o.addedAt ?? '' })),
                savedLoaded: liked.access === 'readable',
              }
            : {}),
        };
      }),
    [],
  );
  return {
    library,
    refreshing,
    metadataLoading,
    error,
    status,
    refresh,
    load,
    loadMetadata,
    replace,
    clearError: () => setError(''),
  };
}

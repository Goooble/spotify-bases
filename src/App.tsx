import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDownUp,
  Columns3,
  ExternalLink,
  Filter as FilterIcon,
  Library as LibraryIcon,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import {
  clientId,
  configError,
  connect,
  disconnect,
  finishCallback,
  readTokens,
  canEditLikedSongs,
} from './auth';
import {
  defaultPreferences,
  loadPreferences,
  normalize,
  preferenceKey,
  orderedPlaylistIds,
  movePlaylistColumn,
  type Library,
  type LibraryItem,
  type Playlist,
  type Preferences,
  type Sort,
} from './model';
import { group, pruneSelection, query, type Filter } from './filters';
import { errorMessage, spotify } from './spotify';
import { usePlaylistLibrary } from './usePlaylistLibrary';
import { useRateLimit } from './useRateLimit';
import { saveBatch, undoBatch, stage, type Drafts, type SavedBatch } from './batchEdits';
import { continueCreation, type Creation } from './operations';
import LibraryTable from './LibraryTable';
import FilterEditor from './FilterEditor';
import Sidebar from './Sidebar';
function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title} settings and controls</Dialog.Description>
          <Dialog.Close className="modal-close icon-button" aria-label="Close dialog">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export default function App() {
  const cooldown = useRateLimit();
  const networkBlocked = cooldown.seconds > 0;
  const [connected, setConnected] = useState(!!readTokens());
  const [initialized, setInitialized] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [filter, setFilter] = useState<Filter>(group);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<SavedBatch>();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [guard, setGuard] = useState<'refresh' | 'logout'>();
  const [preview, setPreview] = useState<LibraryItem>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creation, setCreation] = useState<Creation>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const prefKey = useRef('');
  const onAccount = useCallback((account: Library['account']) => {
    const key = preferenceKey(clientId, account.account_id ?? account.id);
    if (prefKey.current !== key) {
      prefKey.current = key;
      setPrefs({ ...loadPreferences(key), columns: [] });
    }
  }, []);
  const workspace = usePlaylistLibrary(initialized && connected, prefs.columns, onAccount);
  const { library, refreshing } = workspace;
  const pendingCount = Object.keys(drafts).length;
  const busy = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    if (workspace.error) setError(workspace.error);
  }, [workspace.error]);
  useEffect(() => {
    if (!pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);
  const updatePrefs = useCallback((next: Preferences) => {
    setPrefs(next);
    if (prefKey.current)
      try {
        localStorage.setItem(prefKey.current, JSON.stringify({ ...next, columns: [] }));
      } catch {
        setError('Browser storage is full or unavailable. Preferences could not be saved.');
      }
  }, []);
  async function refresh() {
    if (savingRef.current || workspace.metadataLoading) return;
    if (pendingCount) {
      setGuard('refresh');
      return;
    }
    setError('');
    setStatus('');
    setSelected(new Set());
    setUndo(undefined);
    await workspace.refresh();
  }
  useEffect(() => {
    let active = true;
    finishCallback()
      .then(() => {
        if (active) {
          setConnected(!!readTokens());
          setInitialized(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(errorMessage(e));
          setInitialized(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(undefined), Math.max(0, undo.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [undo]);
  const rows = useMemo(() => {
    const normalized = normalize(library?.saved ?? [], library?.playlists ?? []);
    return normalized.filter((r) => Object.keys(r.memberships).length > 0);
  }, [library]);
  const activePlaylists = useMemo(
    () =>
      orderedPlaylistIds(prefs.columns, prefs.playlistOrder)
        .map((id) => library?.playlists.find((p) => p.id === id && p.access === 'readable'))
        .filter((p): p is Playlist => !!p),
    [prefs.columns, prefs.playlistOrder, library],
  );
  const results = useMemo(
    () =>
      activePlaylists.length
        ? query(
            rows,
            prefs.search,
            filter,
            prefs.sort,
            activePlaylists.map((p) => p.id),
          )
        : [],
    [rows, prefs.search, filter, prefs.sort, activePlaylists],
  );
  useEffect(() => {
    setSelected((current) => {
      const next = pruneSelection(current, results);
      return next.size === current.size ? current : next;
    });
  }, [results]);
  function membership(p: Playlist, row: LibraryItem, present: boolean) {
    if (savingRef.current || creating || p.access !== 'readable' || !p.editable) return;
    setDrafts((current) => stage(current, p, row, present));
    setError('');
  }
  async function saveChanges() {
    if (savingRef.current || !pendingCount || !library) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setUndo(undefined);
    try {
      const result = await saveBatch(spotify, library.playlists, drafts);
      workspace.replace(result.playlists);
      setDrafts(result.remaining);
      setUndo(result.undo);
      setError(result.errors.join(' '));
      setStatus(
        Object.keys(result.remaining).length
          ? 'Save paused. Unapplied edits remain pending.'
          : 'Changes saved',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function performUndo() {
    if (!undo || savingRef.current || refreshing || creating) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await undoBatch(spotify, undo, library?.playlists ?? []);
      workspace.replace(result.playlists);
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, draft]) => {
            const p = result.playlists.find((p) => p.id === draft.playlistId);
            return (
              !p ||
              p.access !== 'readable' ||
              p.occurrences.some((o) => o.uri === draft.uri) !== draft.present
            );
          }),
        ),
      );
      setUndo(result.undo);
      setError(result.errors.join(' '));
      setStatus(result.errors.length ? 'Undo finished with errors.' : 'Saved changes undone');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  function openCreation() {
    if (!creation || creation.complete) {
      setCreation(undefined);
      setName('');
      setDescription('');
    }
    setCreateOpen(true);
  }
  async function createPlaylist() {
    if (creating) return;
    const job = creation ?? {
      uris: results.filter((r) => selected.has(r.uri)).map((r) => r.uri),
      name: name.trim(),
      description,
      confirmed: 0,
      uncertain: false,
      complete: false,
    };
    if (!job.name || !job.uris.length) return;
    setCreating(true);
    setError('');
    try {
      await continueCreation(spotify, job, setCreation);
      setStatus('Public playlist created');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }
  const allLoaded =
    !!library &&
    !refreshing &&
    library.playlists
      .filter((p) => prefs.columns.includes(p.id))
      .every((p) => p.access === 'readable' || p.access === 'inaccessible');
  const changeSort = (field: string) =>
    updatePrefs({
      ...prefs,
      sort: field.startsWith('membership:')
        ? { ...prefs.sort, field: 'membership', playlist: field.slice(11) }
        : { field: field as Sort['field'], desc: prefs.sort.desc },
    });
  const activeFilterCount = (f: Filter): number =>
    f.kind === 'condition'
      ? f.value
        ? 1
        : 0
      : f.children.reduce((n, c) => n + activeFilterCount(c), 0);
  function logout() {
    if (pendingCount) {
      setGuard('logout');
      return;
    }
    disconnect();
    setConnected(false);
    prefKey.current = '';
    setPrefs(defaultPreferences());
    setFilter(group());
    setSelected(new Set());
    setPreview(undefined);
    setUndo(undefined);
    setCreation(undefined);
    setStatus('Disconnected');
  }
  if (!connected)
    return (
      <div className="welcome">
        <div className="brand">
          <LibraryIcon size={25} />
          <span>
            spotify<span className="brand-light">bases</span>
          </span>
        </div>
        <div className="welcome-card">
          <div className="eyebrow">YOUR MUSIC, IN PERSPECTIVE</div>
          <h1>
            A little structure.
            <br />A lot of discovery.
          </h1>
          <p>
            Explore the music you already love. Find the overlap between playlists, filter your
            library, and build something new.
          </p>
          <button
            className="primary"
            disabled={!!configError()}
            onClick={() => connect().catch((e) => setError(errorMessage(e)))}
          >
            Connect with Spotify <ExternalLink size={16} />
          </button>
          {configError() && (
            <div className="setup">
              <h3>Connect your own Spotify app</h3>
              <p>{configError()}</p>
              <code>VITE_SPOTIFY_REDIRECT_URI={location.origin}/callback</code>
              <p>
                Register the redirect URI in the Spotify developer dashboard. The app owner needs
                Spotify Premium.
              </p>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <small>
            A personal, self-hosted workspace. Folders and preferences stay in this browser.
          </small>
        </div>
        <div className="welcome-decoration" aria-hidden="true">
          <span>Title</span>
          <span>Artist</span>
          <span>Playlist A</span>
          <span>Playlist B</span>
          {Array.from({ length: 20 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <LibraryIcon size={24} />
          <span>
            spotify<span className="brand-light">bases</span>
          </span>
          <span className="personal-tag">PERSONAL LIBRARY</span>
        </div>
        <div className="header-actions">
          <span className="account">{library?.account.display_name ?? 'Connected to Spotify'}</span>
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={18} />
          </button>
          <button
            className="icon-button"
            disabled={refreshing || saving || creating || workspace.metadataLoading}
            aria-label="Disconnect Spotify"
            onClick={logout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <div className="app-body">
        <Sidebar
          playlists={library?.playlists ?? []}
          prefs={prefs}
          onChange={updatePrefs}
          disabled={saving || creating || refreshing}
          onRetry={(id) => void workspace.load(id)}
        />
        <main>
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">ALL YOUR MUSIC, ONE PLACE</div>
              <h1>
                Your library<span className="count-pill">{rows.length.toLocaleString()}</span>
              </h1>
              <p>Find connections. Make your next playlist.</p>
            </div>
            <button
              className="primary"
              disabled={
                (!selected.size && (!creation || creation.complete)) ||
                refreshing ||
                creating ||
                saving ||
                networkBlocked
              }
              onClick={openCreation}
            >
              <Plus size={17} />{' '}
              {creation && !creation.complete
                ? 'Resume playlist creation'
                : `Create playlist${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
          <div className="toolbar">
            <label className="search">
              <Search size={17} />
              <input
                placeholder="Search title, artist, album…"
                aria-label="Search library"
                value={prefs.search}
                onChange={(e) => updatePrefs({ ...prefs, search: e.target.value })}
              />
              {prefs.search && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => updatePrefs({ ...prefs, search: '' })}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <button
              className={activeFilterCount(filter) ? 'active' : ''}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <FilterIcon size={16} /> Filters
              {activeFilterCount(filter) > 0 ? ` (${activeFilterCount(filter)})` : ''}
            </button>
            <label className="sort-control">
              <ArrowDownUp size={16} />
              <select
                aria-label="Sort by"
                value={
                  prefs.sort.field === 'membership'
                    ? `membership:${prefs.sort.playlist}`
                    : prefs.sort.field
                }
                onChange={(e) => changeSort(e.target.value)}
              >
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="album">Album</option>
                <option value="savedAt" disabled={!library?.savedLoaded}>
                  Library added{!library?.savedLoaded ? ' (load metadata first)' : ''}
                </option>
                {activePlaylists.map((p) => (
                  <option key={p.id} value={`membership:${p.id}`}>
                    {p.name} membership
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Reverse sort direction"
              onClick={() =>
                updatePrefs({ ...prefs, sort: { ...prefs.sort, desc: !prefs.sort.desc } })
              }
            >
              {prefs.sort.desc ? '↓' : '↑'}
            </button>
            <button aria-label="Visible columns" onClick={() => setColumnsOpen(true)}>
              <Columns3 size={16} />
            </button>
            <button
              className="refresh-button"
              disabled={
                refreshing || saving || creating || workspace.metadataLoading || networkBlocked
              }
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
          {cooldown.state && (
            <section className="warning" role="status" aria-label="Spotify access cooldown">
              <strong>
                {cooldown.state.reason === 'QUOTA_EXCEEDED'
                  ? 'Spotify development quota exceeded'
                  : 'Spotify rate limit reached'}
              </strong>
              <p>
                {cooldown.seconds > 0
                  ? `Requests paused for ${cooldown.seconds} more seconds, until ${new Date(cooldown.state.retryAt).toLocaleString()}.`
                  : 'The app pause has ended. Retry manually when ready; Spotify may still report a limit.'}
              </p>
              <p>
                {cooldown.state.retryAfterSeconds === null
                  ? 'Retry-After was unavailable to this browser. Spotify’s reset time is unknown. The pause above is an app safeguard, not a confirmed quota reset.'
                  : `Spotify returned Retry-After: ${cooldown.state.retryAfterSeconds} seconds.`}{' '}
                No automatic retries.
              </p>
              <small>
                Last response: {cooldown.state.reason} · {cooldown.state.path} ·{' '}
                {cooldown.state.serverMessage}
              </small>
            </section>
          )}
          {workspace.metadataLoading && (
            <p className="metadata-action" role="status">
              Loading Liked Songs and saved-track metadata…
            </p>
          )}
          {library && !canEditLikedSongs() && (
            <div className="metadata-action">
              <button
                disabled={saving || creating || refreshing || pendingCount > 0}
                onClick={() => connect().catch((e) => setError(errorMessage(e)))}
              >
                Reconnect to edit Liked Songs
              </button>
              <small>
                Your existing connection can read Liked Songs. Reconnect to grant saved-track
                editing permission.
              </small>
            </div>
          )}
          {pendingCount > 0 && (
            <section className="draft-bar" aria-label="Pending playlist changes">
              <strong>{pendingCount} pending changes</strong>
              <div>
                {[...new Set(Object.values(drafts).map((d) => d.playlistId))].map((id) => {
                  const changes = Object.values(drafts).filter((d) => d.playlistId === id);
                  return (
                    <span key={id}>
                      {library?.playlists.find((p) => p.id === id)?.name ?? id}: +
                      {changes.filter((d) => d.present).length} / ?
                      {changes.filter((d) => !d.present).length}
                    </span>
                  );
                })}
              </div>
              <button
                className="primary"
                disabled={
                  saving || creating || refreshing || workspace.metadataLoading || networkBlocked
                }
                onClick={() => void saveChanges()}
              >
                Save changes ({pendingCount})
              </button>
              <button disabled={saving || creating} onClick={() => setDrafts({})}>
                Discard changes
              </button>
            </section>
          )}
          {activePlaylists.length > 0 && (
            <div className="playlist-scope" aria-label="Selected playlist filter">
              <span>In any selected playlist:</span>
              {activePlaylists.map((p) => (
                <button
                  key={p.id}
                  className="playlist-chip"
                  aria-label={`Remove ${p.name} from playlist selection`}
                  onClick={() =>
                    updatePrefs({ ...prefs, columns: prefs.columns.filter((id) => id !== p.id) })
                  }
                >
                  {p.name}
                  <X size={12} />
                </button>
              ))}
              <button
                className="clear-playlist-selection"
                onClick={() => updatePrefs({ ...prefs, columns: [] })}
              >
                Clear playlist selection
              </button>
            </div>
          )}
          {filtersOpen && (
            <div className="filter-panel">
              <div className="panel-heading">
                <strong>Filter your library</strong>
                <button onClick={() => setFilter(group())}>Clear advanced filters</button>
              </div>
              <FilterEditor
                filter={filter}
                onChange={setFilter}
                playlists={library?.playlists ?? []}
                savedLoaded={!!library?.savedLoaded}
              />
            </div>
          )}
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {library?.errors.length ? (
            <details className="warning">
              <summary>
                {library.errors.length} source(s) failed to load. Results are incomplete.
              </summary>
              {library.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </details>
          ) : null}
          <div className="result-bar">
            <span>
              <strong>{results.length.toLocaleString()}</strong> items
              {selected.size > 0 && ` · ${selected.size.toLocaleString()} selected`}
              {!allLoaded && ' · partial library'}
            </span>
            <span>{activePlaylists.length} playlist columns</span>
          </div>
          <LibraryTable
            resetKey={JSON.stringify([prefs.search, filter, [...prefs.columns].sort()])}
            sort={prefs.sort}
            onPlaylistSort={(id) =>
              updatePrefs({
                ...prefs,
                sort: {
                  field: 'membership',
                  playlist: id,
                  desc:
                    prefs.sort.field === 'membership' && prefs.sort.playlist === id
                      ? !prefs.sort.desc
                      : false,
                },
              })
            }
            onPlaylistMove={(from, to) =>
              updatePrefs({
                ...prefs,
                playlistOrder: movePlaylistColumn(prefs.columns, prefs.playlistOrder, from, to),
              })
            }
            rows={results}
            playlists={activePlaylists}
            selected={selected}
            onSelect={setSelected}
            onPreview={(r) => {
              setPreview(r);
              setPreviewFailed(false);
            }}
            onMembership={(p, r, present) => void membership(p, r, present)}
            busy={busy}
            disabled={refreshing || creating || saving}
            drafts={drafts}
            emptyMessage={
              !prefs.columns.length
                ? 'Select playlists to load their tracks'
                : library?.playlists.some(
                      (p) =>
                        prefs.columns.includes(p.id) &&
                        (p.access === 'loading' || p.access === 'unloaded'),
                    )
                  ? 'Loading selected playlists?'
                  : 'No matching items'
            }
            widths={prefs.widths}
            onWidths={(widths) => updatePrefs({ ...prefs, widths })}
            hidden={prefs.hidden}
            savedLoaded={!!library?.savedLoaded}
          />
          <footer className="workspace-footer">
            <span className="status-dot" />
            <span role="status">{status || workspace.status || 'Connecting…'}</span>
            <span className="last-refreshed">
              {library?.refreshedAt
                ? `Last complete refresh ${new Date(library.refreshedAt).toLocaleString()}`
                : 'No complete refresh yet'}
            </span>
          </footer>
        </main>
      </div>
      {undo && (
        <div className="toast" role="status">
          Saved playlist changes
          <button
            disabled={saving || refreshing || creating || networkBlocked}
            onClick={() => void performUndo()}
          >
            Undo
          </button>
          <small>15 seconds</small>
        </div>
      )}
      <Modal
        open={!!guard}
        onOpenChange={(open) => {
          if (!open) setGuard(undefined);
        }}
        title="Unsaved playlist changes"
      >
        <p>
          Save your changes first, or discard them to{' '}
          {guard === 'refresh' ? 'refresh' : 'disconnect'}. Your pending edits have not been sent to
          Spotify.
        </p>
        <button onClick={() => setGuard(undefined)}>Keep editing</button>
        <button
          onClick={() => {
            const action = guard;
            setGuard(undefined);
            setDrafts({});
            if (action === 'refresh') {
              setUndo(undefined);
              void workspace.refresh();
            } else {
              disconnect();
              setConnected(false);
              prefKey.current = '';
              setPrefs(defaultPreferences());
              setSelected(new Set());
              setPreview(undefined);
              setUndo(undefined);
              setCreation(undefined);
            }
          }}
        >
          Discard and {guard === 'refresh' ? 'refresh' : 'disconnect'}
        </button>
      </Modal>
      {preview && (
        <div className="preview-bar">
          {preview.image && <img src={preview.image} alt="" />}
          <div className="preview-identity">
            <strong>{preview.title}</strong>
            <span>{preview.artists.join(', ')}</span>
          </div>
          {preview.preview && !previewFailed ? (
            <audio
              key={preview.uri}
              src={preview.preview}
              controls
              preload="none"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <span className="preview-unavailable">Preview unavailable</span>
          )}
          <a href={preview.url} target="_blank" rel="noreferrer">
            Open in Spotify <ExternalLink size={14} />
          </a>
          <button
            className="icon-button"
            aria-label="Close preview"
            onClick={() => setPreview(undefined)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <Modal open={columnsOpen} onOpenChange={setColumnsOpen} title="Visible metadata columns">
        {['artist', 'album', 'duration', 'savedAt', 'saved'].map((id) => (
          <label className="settings-row" key={id}>
            <input
              type="checkbox"
              checked={!prefs.hidden.includes(id)}
              onChange={(e) =>
                updatePrefs({
                  ...prefs,
                  hidden: e.target.checked
                    ? prefs.hidden.filter((v) => v !== id)
                    : [...prefs.hidden, id],
                })
              }
            />
            {
              {
                artist: 'Artist / creator',
                album: 'Album / show',
                duration: 'Duration',
                savedAt: 'Library added date',
                saved: 'Liked status',
              }[id]
            }
          </label>
        ))}
      </Modal>
      <Modal open={settingsOpen} onOpenChange={setSettingsOpen} title="Workspace settings">
        <p>
          Spotify tokens persist in this browser until you disconnect. Use a browser profile you
          trust.
        </p>
        <p>
          Folders and preferences belong to this account and this deployment. Spotify metadata is
          loaded fresh and kept in memory.
        </p>
        <button
          onClick={() => {
            updatePrefs(defaultPreferences());
            setFilter(group());
            setSelected(new Set());
          }}
        >
          Reset folders and display preferences
        </button>
        <p>
          <a href="https://www.spotify.com/account/apps/" target="_blank" rel="noreferrer">
            Manage Spotify app access ↗
          </a>
        </p>
        <small>
          Disconnect clears local tokens; revoke access in Spotify to remove the app’s
          authorization.
        </small>
      </Modal>
      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
        }}
        title="Create a public playlist"
      >
        {!creation?.playlist && (
          <>
            <p>
              {creation?.uris.length ?? selected.size} selected items will be added in the current
              table order.
            </p>
            <label className="form-label">
              Playlist name
              <input
                value={name}
                maxLength={100}
                disabled={creating || !!creation}
                onChange={(e) => setName(e.target.value)}
                placeholder="A new perspective"
              />
            </label>
            <label className="form-label">
              Description
              <textarea
                value={description}
                maxLength={300}
                disabled={creating || !!creation}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </>
        )}
        {creation && (
          <p role="status">
            {creation.confirmed} of {creation.uris.length} items added
            {creation.complete ? ' · Complete' : creating ? '…' : ' · Paused'}
          </p>
        )}
        {creation?.playlist && (
          <p>
            <a
              target="_blank"
              rel="noreferrer"
              href={
                creation.playlist.external_urls?.spotify ??
                `https://open.spotify.com/playlist/${creation.playlist.id}`
              }
            >
              Open playlist in Spotify ↗
            </a>
          </p>
        )}
        {!creation?.complete && (
          <button
            className="primary"
            disabled={
              creating ||
              networkBlocked ||
              !(creation?.name ?? name).trim() ||
              (creation?.uncertain && !creation.playlist)
            }
            onClick={() => void createPlaylist()}
          >
            {creating
              ? 'Creating…'
              : creation
                ? 'Resume playlist creation'
                : 'Create public playlist'}
          </button>
        )}
        {creation?.uncertain && !creation.playlist && (
          <p className="error">
            Creation outcome is unknown. Check Spotify before starting another playlist.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}

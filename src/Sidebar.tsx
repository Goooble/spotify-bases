import { useState } from 'react';
import {
  FolderPlus,
  Folder as FolderIcon,
  ListMusic,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Heart,
} from 'lucide-react';
import { LIKED_SONGS_ID, type Playlist, type Preferences, type Folder } from './model';
export default function Sidebar({
  playlists,
  prefs,
  onChange,
  disabled,
  onRetry,
}: {
  playlists: Playlist[];
  prefs: Preferences;
  onChange: (p: Preferences) => void;
  disabled: boolean;
  onRetry: (id: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLocaleLowerCase();
  const matches = (p: Playlist) => !needle || p.name.toLocaleLowerCase().includes(needle);
  const updateFolder = (folder: Folder) =>
    onChange({ ...prefs, folders: prefs.folders.map((f) => (f.id === folder.id ? folder : f)) });
  const toggle = (ids: string[]) => {
    const columns = new Set(prefs.columns);
    const all = ids.every((id) => columns.has(id));
    ids.forEach((id) => (all ? columns.delete(id) : columns.add(id)));
    onChange({ ...prefs, columns: [...columns] });
  };
  const playlist = (p: Playlist) => (
    <div className="playlist-entry" key={p.id}>
      <label title={p.reason ?? (p.editable ? 'Editable playlist' : 'Read-only playlist')}>
        <input
          type="checkbox"
          aria-label={p.name}
          checked={prefs.columns.includes(p.id)}
          disabled={disabled || p.access === 'inaccessible'}
          onChange={() => toggle([p.id])}
        />
        {p.id === LIKED_SONGS_ID ? <Heart size={15} /> : <ListMusic size={15} />}
        <span>
          {p.name}
          <small>
            {p.access === 'unloaded'
              ? 'Select to load'
              : p.access === 'loading'
                ? 'Loading…'
                : p.access === 'readable'
                  ? `${p.occurrences.length} items${p.editable ? '' : ' · read only'}`
                  : p.reason}
          </small>
        </span>
      </label>
      {p.access === 'failed' && (
        <button
          disabled={disabled || (p.id !== LIKED_SONGS_ID && !prefs.columns.includes(p.id))}
          onClick={() => onRetry(p.id)}
        >
          Retry loading
        </button>
      )}
      <select
        aria-label={`Move ${p.name} to folder`}
        title="Move to local folder"
        value={prefs.folders.find((f) => f.playlists.includes(p.id))?.id ?? ''}
        onChange={(e) =>
          onChange({
            ...prefs,
            folders: prefs.folders.map((f) => ({
              ...f,
              playlists: [
                ...f.playlists.filter((id) => id !== p.id),
                ...(f.id === e.target.value ? [p.id] : []),
              ],
            })),
          })
        }
      >
        <option value="">No folder</option>
        {prefs.folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <aside>
      <div className="sidebar-heading">
        <span>PLAYLISTS</span>
        <button
          className="icon-button"
          title="Create local folder"
          aria-label="Create local folder"
          onClick={() => setAdding(!adding)}
        >
          <FolderPlus size={18} />
        </button>
      </div>
      <p className="sidebar-help">Select playlists to show their tracks and membership columns.</p>
      <label className="sidebar-search">
        <Search size={14} />
        <input
          aria-label="Search playlists"
          placeholder="Search playlists…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button
            className="icon-button"
            aria-label="Clear playlist search"
            onClick={() => setSearch('')}
          >
            <X size={13} />
          </button>
        )}
      </label>
      {adding && (
        <form
          className="folder-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            onChange({
              ...prefs,
              folders: [
                ...prefs.folders,
                { id: crypto.randomUUID(), name: newName.trim(), playlists: [], collapsed: false },
              ],
            });
            setNewName('');
            setAdding(false);
          }}
        >
          <input
            autoFocus
            aria-label="New folder name"
            placeholder="Folder name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button>Add</button>
        </form>
      )}
      <div className="sidebar-list">
        {prefs.folders.map(
          (folder, index) =>
            (!needle ||
              folder.playlists.some((id) => playlists.some((p) => p.id === id && matches(p)))) && (
              <section className="folder" key={folder.id}>
                <div className="folder-heading">
                  <button
                    className="icon-button"
                    aria-label={`${folder.collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                    onClick={() => updateFolder({ ...folder, collapsed: !folder.collapsed })}
                  >
                    {folder.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  </button>
                  <FolderIcon size={15} />
                  <input
                    className="folder-name"
                    aria-label="Rename folder"
                    value={folder.name}
                    onChange={(e) => updateFolder({ ...folder, name: e.target.value })}
                  />
                  <button
                    className="icon-button"
                    disabled={disabled}
                    title="Select or clear the visible playlists in this folder"
                    aria-label={`Toggle playlists in ${folder.name}`}
                    onClick={() =>
                      toggle(
                        playlists
                          .filter(
                            (p) =>
                              folder.playlists.includes(p.id) &&
                              p.access !== 'inaccessible' &&
                              matches(p),
                          )
                          .map((p) => p.id),
                      )
                    }
                  >
                    ±
                  </button>
                </div>
                {(!folder.collapsed || !!needle) && (
                  <>
                    <div className="folder-controls">
                      <button
                        disabled={index === 0}
                        onClick={() => {
                          const folders = [...prefs.folders];
                          [folders[index - 1], folders[index]] = [
                            folders[index],
                            folders[index - 1],
                          ];
                          onChange({ ...prefs, folders });
                        }}
                      >
                        Move up
                      </button>
                      <button
                        disabled={index === prefs.folders.length - 1}
                        onClick={() => {
                          const folders = [...prefs.folders];
                          [folders[index + 1], folders[index]] = [
                            folders[index],
                            folders[index + 1],
                          ];
                          onChange({ ...prefs, folders });
                        }}
                      >
                        Move down
                      </button>
                      <button
                        onClick={() =>
                          onChange({
                            ...prefs,
                            folders: prefs.folders.filter((f) => f.id !== folder.id),
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                    {folder.playlists
                      .map((id) => playlists.find((p) => p.id === id))
                      .filter((p): p is Playlist => !!p)
                      .filter(matches)
                      .map(playlist)}
                  </>
                )}
              </section>
            ),
        )}
        {playlists
          .filter((p) => !prefs.folders.some((f) => f.playlists.includes(p.id)))
          .filter(matches)
          .map(playlist)}
        {!playlists.length && <p className="sidebar-help">Your playlists will appear here.</p>}
        {!!playlists.length && !playlists.some(matches) && (
          <p className="sidebar-help" role="status">
            No playlists match your search.
          </p>
        )}
      </div>
      <div className="sidebar-footer">
        <span className="status-dot" /> App-local folders
        <span>Nothing here changes Spotify folders.</span>
      </div>
    </aside>
  );
}

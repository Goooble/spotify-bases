import type { Preferences } from './model';

// Apply this tab's edits to the latest stored state, preserving other tabs' changes.
export function mergePreferences(
  previous: Preferences,
  next: Preferences,
  saved: Preferences,
): Preferences {
  const merged = { ...saved, columns: next.columns };
  for (const key of ['playlistOrder', 'widths', 'search', 'sort', 'hidden'] as const) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
      Object.assign(merged, { [key]: next[key] });
  }
  const removed = new Set(
    previous.folders.filter((f) => !next.folders.some((n) => n.id === f.id)).map((f) => f.id),
  );
  let folders = saved.folders.filter((f) => !removed.has(f.id));
  const moved = new Map<string, string>();
  for (const folder of next.folders) {
    const before = previous.folders.find((f) => f.id === folder.id);
    if (!before) {
      folders = [...folders.filter((f) => f.id !== folder.id), folder];
      folder.playlists.forEach((id) => moved.set(id, folder.id));
      continue;
    }
    const additions = folder.playlists.filter((id) => !before.playlists.includes(id));
    const deletions = new Set(before.playlists.filter((id) => !folder.playlists.includes(id)));
    if (folders.some((f) => f.id === folder.id))
      additions.forEach((id) => moved.set(id, folder.id));
    folders = folders.map((current) =>
      current.id === folder.id
        ? {
            ...current,
            ...(folder.name !== before.name ? { name: folder.name } : {}),
            ...(folder.collapsed !== before.collapsed ? { collapsed: folder.collapsed } : {}),
            playlists: [
              ...new Set([...current.playlists.filter((id) => !deletions.has(id)), ...additions]),
            ],
          }
        : current,
    );
  }
  folders = folders.map((f) => ({
    ...f,
    playlists: f.playlists.filter((id) => !moved.has(id) || moved.get(id) === f.id),
  }));
  if (previous.folders.map((f) => f.id).join(',') !== next.folders.map((f) => f.id).join(',')) {
    const order = [...next.folders.map((f) => f.id), ...folders.map((f) => f.id)];
    folders.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  return { ...merged, folders };
}

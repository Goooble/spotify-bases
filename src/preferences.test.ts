import { describe, expect, it } from 'vitest';
import { defaultPreferences, type Folder } from './model';
import { mergePreferences } from './preferences';

const folder = (id: string, playlists: string[] = []): Folder => ({
  id,
  name: id,
  playlists,
  collapsed: false,
});
describe('preference updates from older tabs', () => {
  it('keeps newer folders when an old tab changes search or selects columns', () => {
    const old = defaultPreferences();
    const saved = { ...old, folders: [folder('New folder', ['p'])] };
    const result = mergePreferences(old, { ...old, search: 'Alpha', columns: ['p'] }, saved);
    expect(result.folders).toEqual(saved.folders);
    expect(result.columns).toEqual(['p']);
    expect(result.search).toBe('Alpha');
  });
  it('combines independent assignments and preserves a newer folder name', () => {
    const old = { ...defaultPreferences(), folders: [folder('a', ['p'])] };
    const saved = { ...old, folders: [{ ...folder('a', ['p', 'remote']), name: 'Renamed' }] };
    const result = mergePreferences(old, { ...old, folders: [folder('a', ['p', 'local'])] }, saved);
    expect(result.folders[0]).toMatchObject({
      name: 'Renamed',
      playlists: ['p', 'remote', 'local'],
    });
    expect(saved.folders[0].playlists).toEqual(['p', 'remote']);
  });
  it('applies explicit moves once while keeping other newer assignments', () => {
    const old = {
      ...defaultPreferences(),
      folders: [folder('a', ['p']), folder('b'), folder('c')],
    };
    const saved = { ...old, folders: [folder('a'), folder('b', ['extra']), folder('c', ['p'])] };
    const result = mergePreferences(
      old,
      { ...old, folders: [folder('a'), folder('b', ['p']), folder('c')] },
      saved,
    );
    expect(result.folders.map((f) => f.playlists)).toEqual([[], ['extra', 'p'], []]);
  });
  it('does not resurrect a deleted folder or erase an independently created one', () => {
    const old = { ...defaultPreferences(), folders: [folder('a'), folder('b')] };
    const saved = { ...old, folders: [folder('b'), folder('remote')] };
    const next = { ...old, folders: [{ ...folder('a'), name: 'Late rename' }] };
    expect(mergePreferences(old, next, saved).folders).toEqual([folder('remote')]);
  });
});

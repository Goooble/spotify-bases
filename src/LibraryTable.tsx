import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from '@tanstack/react-table';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Headphones, Music2, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { LIKED_SONGS_ID, type LibraryItem, type Playlist, type Sort } from './model';
import { draftKey, type Drafts } from './batchEdits';
export default function LibraryTable({
  rows,
  playlists,
  selected,
  onSelect,
  onPreview,
  onMembership,
  busy,
  disabled,
  widths,
  onWidths,
  hidden,
  savedLoaded,
  resetKey,
  drafts,
  emptyMessage,
  sort,
  onPlaylistSort,
  onPlaylistMove,
}: {
  rows: LibraryItem[];
  playlists: Playlist[];
  selected: Set<string>;
  onSelect: (s: Set<string>) => void;
  onPreview: (r: LibraryItem) => void;
  onMembership: (p: Playlist, r: LibraryItem, present: boolean) => void;
  busy: Set<string>;
  disabled: boolean;
  widths: Record<string, number>;
  onWidths: (w: Record<string, number>) => void;
  hidden: string[];
  savedLoaded: boolean;
  resetKey: string;
  drafts: Drafts;
  emptyMessage: string;
  sort: Sort;
  onPlaylistSort: (id: string) => void;
  onPlaylistMove: (from: string, to: string) => void;
}) {
  const dragged = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (scroller.current)
        setScrollMargin(scroller.current.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (shell.current?.parentElement) observer.observe(shell.current.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useLayoutEffect(() => {
    if (!shell.current) return;
    const top = shell.current.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top - 16), behavior: 'instant' });
  }, [resetKey]);
  const columns = useMemo<ColumnDef<LibraryItem>[]>(
    () => [
      {
        id: 'select',
        size: 44,
        minSize: 44,
        maxSize: 44,
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all results"
            checked={rows.length > 0 && selected.size === rows.length}
            onChange={(e) =>
              onSelect(e.target.checked ? new Set(rows.map((r) => r.uri)) : new Set())
            }
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.title}`}
            checked={selected.has(row.original.uri)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(row.original.uri);
              else next.delete(row.original.uri);
              onSelect(next);
            }}
          />
        ),
      },
      {
        id: 'title',
        header: 'Title',
        size: 310,
        minSize: 180,
        cell: ({ row }) => (
          <button
            className="track-title"
            aria-label={row.original.title}
            onClick={() => onPreview(row.original)}
          >
            {row.original.image ? (
              <img src={row.original.image} alt="" loading="lazy" />
            ) : (
              <span className="art-placeholder">
                {row.original.type === 'episode' ? <Headphones size={17} /> : <Music2 size={17} />}
              </span>
            )}
            <span>
              <strong>{row.original.title}</strong>
              <small>
                {row.original.type === 'episode'
                  ? 'Episode'
                  : row.original.explicit
                    ? 'Explicit · Track'
                    : 'Track'}
              </small>
            </span>
          </button>
        ),
      },
      {
        id: 'artist',
        header: 'Artist / creator',
        size: 210,
        cell: ({ row }) => row.original.artists.join(', '),
      },
      {
        id: 'album',
        header: 'Album / show',
        size: 210,
        cell: ({ row }) => row.original.album || '—',
      },
      {
        id: 'duration',
        header: 'Duration',
        size: 100,
        cell: ({ row }) =>
          `${Math.floor(row.original.duration / 60000)}:${String(Math.floor(row.original.duration / 1000) % 60).padStart(2, '0')}`,
      },
      {
        id: 'savedAt',
        header: 'Library added',
        size: 130,
        cell: ({ row }) =>
          savedLoaded ? (row.original.savedAt?.slice(0, 10) ?? '—') : 'Not loaded',
      },
      {
        id: 'saved',
        header: 'Liked',
        size: 75,
        cell: ({ row }) => (row.original.saved ? '♥' : savedLoaded ? '—' : 'Not loaded'),
      },
      ...playlists.map((p) => ({
        id: `playlist:${p.id}`,
        header: p.name,
        size: 150,
        cell: ({ row }: { row: { original: LibraryItem } }) => (
          <input
            type="checkbox"
            aria-label={`${row.original.title} in ${p.name}`}
            className={drafts[draftKey(p.id, row.original.uri)] ? 'pending-membership' : ''}
            title={
              p.editable
                ? drafts[draftKey(p.id, row.original.uri)]
                  ? 'Pending change — click Save changes to apply.'
                  : 'Stage an addition or removal, then click Save changes. Removing membership removes all occurrences.'
                : 'Read-only playlist'
            }
            checked={
              drafts[draftKey(p.id, row.original.uri)]?.present ??
              !!row.original.memberships[p.id]?.length
            }
            disabled={
              disabled ||
              !p.editable ||
              busy.has(p.id) ||
              (p.id === LIKED_SONGS_ID && row.original.type !== 'track')
            }
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onMembership(p, row.original, e.target.checked)}
          />
        ),
      })),
    ],
    [
      rows,
      selected,
      onSelect,
      onPreview,
      onMembership,
      busy,
      disabled,
      playlists,
      savedLoaded,
      drafts,
    ],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.uri,
    state: {
      columnSizing: widths,
      columnVisibility: Object.fromEntries(hidden.map((id) => [id, false])),
    },
    onColumnSizingChange: (updater) =>
      onWidths(typeof updater === 'function' ? updater(widths as ColumnSizingState) : updater),
    columnResizeMode: 'onChange',
  });
  const tableRows = table.getRowModel().rows;
  const virtual = useWindowVirtualizer({
    count: tableRows.length,
    estimateSize: () => 62,
    overscan: 10,
    scrollMargin,
  });
  const items = virtual.getVirtualItems();
  const visibleColumns = table.getVisibleLeafColumns();
  const colgroup = (
    <colgroup>
      {visibleColumns.map((column) => (
        <col key={column.id} style={{ width: column.getSize() }} />
      ))}
    </colgroup>
  );
  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (target && target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
  };
  return (
    <div className="library-table" ref={shell}>
      <div className="table-header-sticky">
        <div
          className="table-header-scroll"
          ref={header}
          tabIndex={0}
          aria-label="Library column headers scroll area"
          onScroll={(event) => syncScroll(event.currentTarget, scroller.current)}
        >
          <table role="presentation" style={{ width: table.getTotalSize() }}>
            {colgroup}
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const id = h.column.id.startsWith('playlist:') ? h.column.id.slice(9) : null;
                    const isSorted =
                      id !== null && sort.field === 'membership' && sort.playlist === id;
                    const direction = isSorted
                      ? sort.desc
                        ? 'descending'
                        : 'ascending'
                      : undefined;
                    return (
                      <th
                        key={h.id}
                        className={
                          h.id === 'select' ? 'pin-select' : h.id === 'title' ? 'pin-title' : ''
                        }
                        style={{ width: h.getSize() }}
                        data-playlist-id={id ?? undefined}
                        data-drop-target={id !== null && dropTarget === id ? true : undefined}
                        aria-sort={direction}
                        onDragOver={(event) => {
                          if (id && dragged.current && dragged.current !== id) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDropTarget(id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dropTarget === id) setDropTarget(null);
                        }}
                        onDrop={(event) => {
                          if (!id) return;
                          event.preventDefault();
                          const from = dragged.current;
                          if (from && from !== id) onPlaylistMove(from, id);
                          dragged.current = null;
                          setDropTarget(null);
                        }}
                      >
                        {id ? (
                          <div className="playlist-column-heading">
                            <button
                              className="column-drag-handle"
                              draggable
                              aria-label={`Move ${String(h.column.columnDef.header)} column`}
                              title="Drag to rearrange playlist columns. Use Left or Right arrow keys to move."
                              onDragStart={(event) => {
                                dragged.current = id;
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', id);
                              }}
                              onDragEnd={() => {
                                dragged.current = null;
                                setDropTarget(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                event.preventDefault();
                                const position = playlists.findIndex((p) => p.id === id),
                                  target =
                                    playlists[position + (event.key === 'ArrowLeft' ? -1 : 1)];
                                if (target) onPlaylistMove(id, target.id);
                              }}
                            >
                              <GripVertical size={13} />
                            </button>
                            <button
                              className="playlist-sort-heading"
                              aria-label={`Sort ${String(h.column.columnDef.header)} membership ${isSorted && !sort.desc ? 'descending' : 'ascending'}`}
                              title={`Sort confirmed membership ${isSorted && !sort.desc ? 'descending (members first)' : 'ascending (non-members first)'}`}
                              onClick={() => onPlaylistSort(id)}
                            >
                              <span>{flexRender(h.column.columnDef.header, h.getContext())}</span>
                              {isSorted ? (
                                sort.desc ? (
                                  <ArrowDown size={13} />
                                ) : (
                                  <ArrowUp size={13} />
                                )
                              ) : null}
                            </button>
                          </div>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                        {h.column.getCanResize() && (
                          <div
                            className="resizer"
                            onMouseDown={h.getResizeHandler()}
                            onTouchStart={h.getResizeHandler()}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
          </table>
        </div>
      </div>
      <div
        className="table-scroll"
        ref={scroller}
        tabIndex={0}
        aria-label="Library table scroll area"
        onScroll={(event) => syncScroll(event.currentTarget, header.current)}
      >
        <table
          style={{ width: table.getTotalSize() }}
          aria-label="Music library"
          aria-rowcount={rows.length + 1}
        >
          {colgroup}
          <thead className="sr-only">
            <tr>
              {visibleColumns.map((column) => (
                <th
                  key={column.id}
                  id={`library-column-${column.id}`}
                  scope="col"
                  aria-sort={
                    sort.field === 'membership' && column.id === `playlist:${sort.playlist}`
                      ? sort.desc
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  {column.id === 'select'
                    ? 'Selection'
                    : column.id === 'title'
                      ? 'Title'
                      : typeof column.columnDef.header === 'string'
                        ? column.columnDef.header
                        : column.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && rows.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleColumns.length}
                  style={{ height: virtual.getTotalSize(), padding: 0, border: 0 }}
                />
              </tr>
            )}
            {items.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleColumns.length}
                  style={{
                    height: Math.max(0, items[0].start - scrollMargin),
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>
            )}
            {items.map((v) => {
              const row = tableRows[v.index];
              return (
                <tr
                  key={row.id}
                  data-index={v.index}
                  aria-rowindex={v.index + 2}
                  aria-selected={selected.has(row.id)}
                  onClick={() => onPreview(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={
                        cell.column.id === 'select'
                          ? 'pin-select'
                          : cell.column.id === 'title'
                            ? 'pin-title'
                            : ''
                      }
                      style={{ width: cell.column.getSize() }}
                      headers={`library-column-${cell.column.id}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {items.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleColumns.length}
                  style={{
                    height: Math.max(
                      0,
                      virtual.getTotalSize() - ((items.at(-1)?.end ?? scrollMargin) - scrollMargin),
                    ),
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            <Music2 size={32} />
            <h3>{emptyMessage}</h3>
            <p>
              {emptyMessage === 'No matching items'
                ? 'Try a different search or clear your filters.'
                : 'Only selected playlists are loaded from Spotify.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

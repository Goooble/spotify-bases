import type { Condition, Field, Filter } from './filters';
import { group } from './filters';
import type { Playlist } from './model';
const labels: Record<Field, string> = {
  playlist: 'Playlist',
  artist: 'Artist / creator',
  album: 'Album / show',
  savedAt: 'Library added date',
  saved: 'Liked / saved',
  type: 'Item type',
  duration: 'Duration (seconds)',
  explicit: 'Explicit',
};
function operators(field: Field): Condition['op'][] {
  return field === 'savedAt'
    ? ['is', 'after', 'before']
    : field === 'duration'
      ? ['greater', 'less']
      : field === 'artist' || field === 'album'
        ? ['is', 'isNot', 'contains']
        : ['is', 'isNot'];
}
const opLabels = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  after: 'on or after',
  before: 'on or before',
  greater: 'greater than',
  less: 'less than',
};
export default function FilterEditor({
  filter,
  onChange,
  playlists,
  depth = 0,
  savedLoaded,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  playlists: Playlist[];
  depth?: number;
  savedLoaded: boolean;
}) {
  if (filter.kind === 'condition')
    return (
      <div className="condition">
        <select
          aria-label="Filter property"
          value={filter.field}
          onChange={(e) => {
            const field = e.target.value as Field;
            onChange({
              ...filter,
              field,
              op: operators(field)[0],
              value: ['saved', 'explicit'].includes(field)
                ? 'true'
                : field === 'type'
                  ? 'track'
                  : '',
            });
          }}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option
              key={value}
              value={value}
              disabled={!savedLoaded && ['saved', 'savedAt'].includes(value)}
            >
              {label}
              {!savedLoaded && ['saved', 'savedAt'].includes(value) ? ' (load metadata first)' : ''}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter operator"
          value={filter.op}
          onChange={(e) => onChange({ ...filter, op: e.target.value as Condition['op'] })}
        >
          {operators(filter.field).map((op) => (
            <option key={op} value={op}>
              {opLabels[op]}
            </option>
          ))}
        </select>
        {filter.field === 'playlist' ? (
          <select
            aria-label="Filter value"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
          >
            <option value="">Choose playlist</option>
            {playlists
              .filter((p) => p.access === 'readable')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        ) : ['saved', 'explicit', 'type'].includes(filter.field) ? (
          <select
            aria-label="Filter value"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
          >
            {(filter.field === 'type' ? ['track', 'episode'] : ['true', 'false']).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Filter value"
            type={
              filter.field === 'savedAt' ? 'date' : filter.field === 'duration' ? 'number' : 'text'
            }
            value={filter.value}
            placeholder="Enter value"
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
          />
        )}
      </div>
    );
  return (
    <fieldset className="filter-group">
      <legend>
        <select
          aria-label="Filter group logic"
          value={filter.mode}
          onChange={(e) => onChange({ ...filter, mode: e.target.value as 'all' | 'any' | 'none' })}
        >
          <option value="all">All (AND)</option>
          <option value="any">Any (OR)</option>
          <option value="none">None (NOT)</option>
        </select>{' '}
        of these conditions
      </legend>
      {filter.children.map((child) => (
        <div key={child.id} className="filter-child">
          <FilterEditor
            filter={child}
            playlists={playlists}
            savedLoaded={savedLoaded}
            depth={depth + 1}
            onChange={(next) =>
              onChange({
                ...filter,
                children: filter.children.map((c) => (c.id === child.id ? next : c)),
              })
            }
          />
          <button
            className="icon-button"
            aria-label="Remove condition or group"
            onClick={() =>
              onChange({ ...filter, children: filter.children.filter((c) => c.id !== child.id) })
            }
          >
            ×
          </button>
        </div>
      ))}
      <div className="filter-actions">
        <button
          onClick={() =>
            onChange({
              ...filter,
              children: [
                ...filter.children,
                {
                  kind: 'condition',
                  id: crypto.randomUUID(),
                  field: 'artist',
                  op: 'contains',
                  value: '',
                },
              ],
            })
          }
        >
          + Condition
        </button>
        <button
          disabled={depth >= 8}
          onClick={() => onChange({ ...filter, children: [...filter.children, group()] })}
        >
          + Group
        </button>
      </div>
    </fieldset>
  );
}

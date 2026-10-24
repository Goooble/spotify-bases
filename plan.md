# Spotify Bases — Product and Implementation Plan

## 1. Product summary

Build a personal web app for managing Spotify playlists and exploring music already present in the user's Spotify library. The core interface is a Bases-inspired table: one row per distinct Spotify item, with track metadata and optional playlist-membership columns. The user narrows the library with search, filters, and sorts, then adds tracks to a new public playlist or edits an existing editable playlist directly from the table.

The app is designed for one Spotify account per deployment. The repository will be open source so other people can self-host their own instance with their own Spotify developer credentials.

## 2. Goals

1. Make it easy to understand how tracks overlap across selected playlists.
2. Let the user query the whole accessible music library with flexible filters.
3. Make playlist membership changes quick, direct, and recoverable with Undo.
4. Assemble a new playlist from filtered results without requiring a separate manual ordering step.
5. Keep the app useful when Spotify limits access to some followed playlists or does not provide preview clips.
6. Keep each self-hosted instance's Spotify connection and app data separate.

## 3. Out of scope for the first version

- Saved/named filter views (planned as a later add-on).
- Drag-and-drop or manual ordering of tracks before playlist creation.
- Recreating or syncing Spotify's playlist-folder hierarchy.
- Multi-user accounts within one deployment.
- Replacing Spotify playback or providing a standalone audio-preview service.
- Advanced non-table layouts such as cards, kanban, or maps.

## 4. Information model

### 4.1 Library dataset

The table dataset is the union of:

- Tracks and episodes from playlists that the API allows the user to read.
- Tracks saved to the user's Spotify library (Liked Songs / saved tracks), including those that are not in any playlist.

Deduplicate rows by Spotify item URI/ID. A specific track appearing in several playlists is one row with membership values across playlists. Different recordings or releases with different Spotify identifiers remain separate rows. Episodes may appear in the same table, without a separate episode mode in the first version.

Each row should retain source information needed for filters and actions, including playlist membership and source-specific added dates where available. The UI should distinguish “added to library” from “added to playlist” if both timestamps are present; date-added filtering in the initial version targets library-added date when available.

### 4.2 Playlist access and editability

- Show playlists Spotify returns for the current account, including playlists the user follows, not only playlists they own.
- Playlist items may be inaccessible for some followed playlists. Keep those playlists discoverable in the sidebar but disabled, with a short explanation. Do not infer their contents.
- Determine whether playlist contents can be edited before enabling membership checkboxes. If a playlist is readable but not editable, show membership as read-only/disabled.
- Spotify playlist folders are not available through the Web API. The app's folders are a separate, local organization layer and never imply or change Spotify folder structure.

### 4.3 App-local data

Persist only app preferences and organization data, such as:

- User-created playlist folders and their playlist assignments/order.
- Selected playlist columns, table display preferences, and last-used sort/search state as appropriate.
- Optional small synchronization metadata needed to refresh efficiently.

Keep the first version's local data model simple and documented. The saved-view feature is excluded for now.

## 5. Product experience

### 5.1 Main layout

- **Left sidebar:** Spotify playlists plus app-managed folders. Folders can contain playlists and expand/collapse. Playlist selection controls which membership columns appear in the table; it does not constrain the table's rows.
- **Main workspace:** Searchable table of the complete accessible library union.
- **Table toolbar:** Filter builder, sort controls, visible-column controls as needed, result count, and a clear **Refresh** button with last-refreshed/status feedback.
- **Bottom preview bar:** Opens when the user clicks a track row. Shows track/episode identity and playback controls for an available 30-second preview; when no preview is available, provides an “Open in Spotify” action.
- **Playlist creation flow:** Create a public Spotify playlist from selected rows in the current result set, with a name and optional description. No manual arrangement step.

### 5.2 Sidebar folders and playlist columns

- List all available playlists from Spotify, subject to API visibility.
- Let the user create, rename, reorder, and delete local folders; folder deletion must not delete or unfollow Spotify playlists.
- Let the user assign a playlist to a local folder and move playlists between folders.
- Selecting one or more playlists displays their membership columns. Playlist folders are only a navigation/column-selection aid; they do not act as implicit row filters.
- Include a sensible way to select/unselect playlists, including bulk selection for a folder if feasible.
- Disabled/inaccessible playlists remain visible and explain the limitation on hover or selection.

### 5.3 Table columns and behavior

Core metadata columns:

- Track/item title
- Artist(s) or creator(s)
- Album/show
- Duration
- Item type (track or episode), if needed for clarity
- Added-to-library date when present
- Liked/saved status

Additional columns:

- One membership checkbox per selected playlist
- Optional membership metadata only if needed later; first version uses checkboxes, not playlist positions

Behavior:

- Keep title visible while horizontally scrolling playlist membership columns when practical.
- Clicking a membership checkbox immediately adds/removes the item from that playlist.
- Show pending/progress feedback, success/error state, and a temporary Undo action after a successful change.
- Prevent duplicate additions when the item is already present. Preserve intentional duplicate entries if they exist in Spotify; row membership means “present at least once.”
- Refresh updates source data and membership state.
- Use pagination or virtualization for large libraries so the interface stays responsive.

### 5.4 Search, filter, and sort

The filter builder should take inspiration from Obsidian Bases rather than attempting to reproduce all of it:

- Each condition has a property, operator, and value.
- Support nested groups using **All / AND**, **Any / OR**, and **None / NOT** semantics.
- Allow composing groups such as `Artist is X AND (Playlist A OR Playlist B)`.
- Global filters apply to the current table dataset. Playlist checkbox columns are display/action columns and do not themselves narrow rows unless the user adds a playlist-membership filter.
- Expose filters for at least playlist membership, artist, album, library-added date range, liked/saved state, and item type. Add explicit-content and duration filters if returned data and UI effort permit.
- Search title, artist, and album/show; search combines with filters by AND.
- Sort by title, artist, album, library-added date, and playlist membership. Support ascending/descending direction and stable secondary sorts if straightforward.
- Show active filters clearly and provide a one-click clear action.
- Saved named views and per-view filter persistence are deliberately deferred.

Obsidian Bases references:

- Bases views combine displayed properties, filters, sorting, and grouping controls. The app adopts the property/operator/value filter model, nested Boolean groups, configurable table columns, search, and sort, while omitting saved views and other layouts in v1: [Views](https://obsidian.md/help/bases/views).
- Bases syntax supports recursively nested `and`, `or`, and `not` groups, and distinguishes filters applying to all views from filters applying to a single view. This app should use the same understandable logic in a visual filter builder; it does not need to adopt the `.base` file format: [Bases syntax](https://obsidian.md/help/bases/syntax).

### 5.5 Preview behavior

- Clicking a row opens/updates a single bottom preview bar; do not add play controls to every row.
- Play a 30-second preview where Spotify provides a usable preview URL.
- If the preview is missing or fails, show a direct “Open in Spotify” link for the item.
- Do not download or cache audio. Preview availability is opportunistic; Spotify marks the preview field deprecated and nullable, and notes clips cannot be offered as a standalone service: [Spotify track reference](https://developer.spotify.com/documentation/web-api/reference/get-track).

### 5.6 New playlist creation

- User selects tracks from the current result set using row selection controls.
- Create a public playlist by default, with editable name and optional description.
- Add selected Spotify URIs in the table's deterministic current order (e.g. current sort order); no separate arrangement UI.
- Display progress and a link to open the new playlist in Spotify.
- Handle Spotify request limits by batching and report partial failures clearly.

### 5.7 Refresh and synchronization

- Refresh automatically on app open after authorization.
- Add a prominent manual **Refresh** button.
- Refresh playlist list, readable playlist contents, saved tracks, and editability/status metadata.
- Display loading state, last successful refresh time, and actionable errors (expired authorization, denied scope, inaccessible playlist, or rate limiting).
- Avoid destructive local caching: Spotify is the source of truth for library/playlists; app folders/preferences remain local.
- On a successful mutation, update the UI immediately and reconcile against Spotify response; use Undo as a compensating change, with clear messaging if later remote changes prevent a clean reversal.

## 6. Technical approach

### 6.1 Stack

- React + TypeScript.
- Vite for development and production builds.
- A maintainable component library/table approach selected during implementation; favor accessible, virtualized table behavior and a clear nested-filter state model.
- Spotify Web API for library, playlists, tracks, and playlist mutations.
- Local persistence for app-created folders and UI state. Choose a small self-host-friendly persistence option after deciding whether the deployment target is static-only or includes a lightweight server.

### 6.2 Authentication and deployment

- Each deployment has its own Spotify application Client ID and configured redirect URI.
- Use Spotify's supported user authorization flow with least-privilege scopes for saved tracks, private/collaborative playlist reads as needed, and playlist creation/modification.
- Never commit credentials or tokens. Provide `.env.example`, setup instructions, and safe local secret handling.
- Keep the app single-user-per-instance. Document callback URL configuration and deployment configuration.
- Decide the hosting shape during implementation: a static React SPA can use PKCE as a public client; if token persistence or host-specific setup warrants a server, add a small TypeScript server rather than exposing a client secret in browser code.
- Include a logout/disconnect action that clears local tokens.

### 6.3 Data and API layer

- Isolate Spotify calls behind typed client/services, not inside table components.
- Normalize playlist items and saved tracks into a common row model keyed by Spotify URI.
- Track per-playlist capabilities (`readable`, `editable`, `reason`) so inaccessible content and read-only membership are represented explicitly.
- Respect Spotify pagination, token expiration, rate limits, partial availability, missing tracks, and API errors.
- Keep Spotify-provided artwork/metadata in original form with links back to Spotify content as required by Spotify's developer policies.
- Treat preview URLs as optional and ephemeral; use Spotify web URLs for fallback links.

### 6.4 Suggested front-end areas

- `auth`: connection state and authorization flow.
- `spotify`: typed API client, pagination, normalization, capability handling.
- `library`: unified dataset and refresh state.
- `filters`: filter AST/types, group editor, evaluation/query integration.
- `playlists`: sidebar, app-local folders, selection, create playlist, membership mutations, Undo.
- `table`: virtualized rows, sort/search, dynamic playlist columns, selection.
- `preview`: single bottom audio preview bar and Spotify fallback.
- `settings`: credentials/configuration status, disconnect, data reset/export if useful.

## 7. Implementation phases

### Phase 0 — Repository foundation

- Initialize React + TypeScript + Vite project structure.
- Add environment example, ignored secrets, README setup, lint/type-check/build scripts, and basic app shell.
- Confirm the intended deployment mode and Spotify redirect URL setup.

### Phase 1 — Spotify connection and data loading

- Implement user authorization and secure token lifecycle.
- Read playlists and saved tracks with pagination.
- Load playlist items where permitted and record inaccessible/read-only states.
- Normalize/deduplicate the unified dataset.
- Add open-time refresh, manual Refresh button, loading/error states, and refresh timestamp.

### Phase 2 — Core library table

- Build the table with search, basic metadata columns, liked state, and date-added data.
- Add dynamic playlist membership columns based on sidebar selection.
- Handle empty states, large data sets, missing items, episodes, and horizontal scrolling.

### Phase 3 — Bases-inspired filtering and sorting

- Implement property/operator/value conditions.
- Add nested AND/OR/NOT groups and filters for playlist membership, artist, album, date range, liked state, and item type.
- Add initial sort choices and clear active filters.
- Keep saved named views out of the first release.

### Phase 4 — Playlist sidebar and local folders

- Build playlist tree/list and selection behavior.
- Implement create/rename/reorder/delete for local folders and playlist assignment/movement.
- Persist local folder data and playlist-column preferences.
- Surface disabled playlists with clear access explanations.

### Phase 5 — Mutations, Undo, and playlist creation

- Add/remove items immediately for editable playlists.
- Add mutation progress/errors and Undo.
- Build selected-track playlist creation flow with public default and Spotify link after creation.
- Reconcile UI state with remote response and handle partial failures.

### Phase 6 — Preview and deployment polish

- Add bottom preview bar with available clip playback and Spotify-link fallback.
- Verify no audio downloading/caching.
- Document self-host setup, Spotify developer app configuration, redirect URLs, environment variables, and deployment.
- Review privacy, token handling, source attribution, and API error behavior.

## 8. Acceptance criteria for the first usable release

1. A self-hoster can configure their own Spotify credentials and connect one account.
2. The app loads accessible playlists and saved tracks and combines them in one table.
3. A saved track with no playlist membership is still visible; the same Spotify URI across playlists produces one row.
4. The sidebar shows playlists and local folders; selecting playlists adds/removes membership columns without filtering the rows.
5. Inaccessible playlists remain visible but disabled with an explanation; read-only membership cannot be edited.
6. Search covers title, artist, and album/show.
7. The user can build nested AND/OR/NOT filters and sort by the agreed properties.
8. Clicking an editable playlist membership checkbox updates Spotify immediately; Undo reverses the change when possible.
9. The user can select filtered results and create a public Spotify playlist, then open it in Spotify.
10. Clicking a row opens the bottom preview bar; an available clip plays, otherwise the Spotify link is offered.
11. Data refreshes on app open and through a visible manual Refresh button, with last-refreshed feedback.
12. Local folders/preferences and credentials are not committed to the repository.

## 9. Risks and mitigations

- **Spotify API access restrictions:** Show inaccessible playlists as disabled; never imply all followed playlist contents can be fetched.
- **Deprecated/missing preview URLs:** Treat clips as optional and provide the Spotify link fallback.
- **Large libraries:** Paginate API calls and virtualize table rows; avoid loading every data page synchronously into the UI.
- **Immediate playlist edits:** Use clear loading/error states and Undo; reconcile with Spotify after mutations.
- **Self-host credential setup:** Include a concise setup guide and validate required configuration at startup.
- **Folder mismatch:** Label folders as app-local and avoid suggesting they sync with Spotify.

## 10. Product decisions already confirmed

- All playlists returned for the user's library, not only owned playlists.
- App-created sidebar folders organize playlists used as membership columns.
- Table rows come from all playlist items plus saved tracks; rows are controlled by filters, not sidebar folder selection.
- AND/OR/NOT nested filtering; global search; no saved views initially.
- Distinct Spotify item identifiers remain separate; identical item URI is deduplicated across sources.
- Checkbox membership, immediate add/remove, and Undo.
- Songs and episodes share the same view.
- Initial sorts: title, artist, album, added date, playlist membership.
- Bottom preview bar, clip when available, Spotify link fallback.
- Automatic refresh on open and a manual Refresh button.
- Public playlist creation, no pre-creation track arrangement.
- Single-user self-hosted deployment with each instance's own Spotify credentials.

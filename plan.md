# Spotify Bases — Product and Implementation Plan

## 1. Product summary

**Last reviewed:** 2026-10-25, against the current source, configuration, and automated tests.

**Implementation status:** V1 is implemented as a static React/Vite SPA with Spotify PKCE, automatic saved-track metadata, a Liked Songs sidebar source, on-demand ordinary playlists, full-page virtualized scrolling, nested filters, searchable local folders, draggable and sortable playlist columns, staged batch Save/Discard/Undo, recoverable public playlist creation, and preview fallback. Rate-limit cooldowns persist across reloads. Latest completed validation: 40 unit tests, 14 browser tests, lint, TypeScript checks, and the production build passed. Real-account permissions, live Spotify behavior, and production hosting still require environment-specific verification; see section 11 and README.md.

Build a personal web app for managing Spotify playlists and exploring music already present in the user's Spotify library. The core interface is a Bases-inspired table: one row per distinct Spotify item, with track metadata and optional playlist-membership columns. The user narrows the library with search, filters, and sorts, then adds tracks to a new public playlist or edits an existing editable playlist directly from the table.

The app is designed for one Spotify account per deployment. The repository will be open source so other people can self-host their own instance with their own Spotify developer credentials.

## 2. Goals

1. Make it easy to understand how tracks overlap across selected playlists.
2. Let the user query selected accessible playlists and Liked Songs with flexible filters.
3. Make membership changes reviewable before Save and recoverable with Undo, while batching API writes.
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

The table dataset is the deduplicated union of tracks and episodes from selected readable playlists. Startup loads account information, the playlist list, and saved-track metadata automatically. Liked Songs appears as a normal sidebar source: selecting it shows saved-only tracks and its editable membership column. Ordinary playlist contents remain on demand. With no selection, the table is empty.

Deduplicate rows by Spotify item URI/ID. A specific track appearing in several playlists is one row with membership values across playlists. Different recordings or releases with different Spotify identifiers remain separate rows. Episodes may appear in the same table, without a separate episode mode in the first version.

Retain source information needed for filters and actions, including playlist membership, duplicate occurrence positions, and source-specific added dates. Display and filter the library-added date; playlist-added timestamps remain internal and must not be substituted for it. Saved status is independent of whether an exact library-added timestamp is available.

Liked Songs contains tracks only; saved episodes are not fetched independently. Null items, local tracks, and unsupported Spotify URIs are omitted from table rows, while playlist occurrence positions are retained internally where available.

### 4.2 Playlist access and editability

- Show playlists Spotify returns for the current account, including playlists the user follows, not only playlists they own.
- Playlist items may be inaccessible for some followed playlists. Keep those playlists discoverable in the sidebar but disabled, with a short explanation. Do not infer their contents.
- Determine whether playlist contents can be edited before enabling membership checkboxes. If a playlist is readable but not editable, show membership as read-only/disabled.
- Ordinary playlists begin unloaded; check access when their contents are requested. Transient load failures offer Retry loading. Deselecting an ordinary playlist cancels unfinished loading and stops further pagination where possible.
- Liked Songs uses saved-library endpoints, not playlist endpoints. Connections without `user-library-modify` can browse it but receive a Reconnect to edit Liked Songs action. Episodes cannot be checked into this source.
- Spotify playlist folders are not available through the Web API. The app's folders are a separate, local organization layer and never imply or change Spotify folder structure.

### 4.3 App-local data

Persist browser-local app state:

- User-created playlist folders and their playlist assignments/order.
- Playlist column order, column widths/visibility, and last-used table search and sort, namespaced by Client ID and Spotify account.
- Authorization tokens until disconnect, scoped to the deployment's Client ID; never commit them. A browser profile with these tokens can use the connection.
- Rate-limit diagnostics and cooldown deadlines, scoped to Client ID and shared across tabs on the same origin.

Playlist selection always starts empty; legacy stored selections are ignored. Advanced filters, sidebar search, row selection, pending edits, Undo records, and loaded Spotify metadata remain session-only. Resetting organization/display preferences is available in Settings. Named saved views remain excluded.

## 5. Product experience

### 5.1 Main layout

- **Left sidebar:** Liked Songs, Spotify playlists, local search, and app-managed folders. Folders can contain sources and expand/collapse. Selecting sources shows their membership columns and filters rows to tracks in any selected source. No selection shows an empty table. The sidebar stays accessible with independent scrolling.
- **Main workspace:** Searchable table of the selected accessible playlists, loaded on demand.
- **Table toolbar:** Filter builder, sort controls, visible-column controls as needed, result count, and a clear **Refresh** button with last-refreshed/status feedback.
- **Pending changes bar:** Visible while scrolling, with a global Save changes count, Discard changes, and per-source addition/removal summaries. Deselecting a source does not discard its pending edits.
- **Bottom preview bar:** Fixed to the bottom when the user clicks a track row. Shows track/episode identity and playback controls for an available preview; “Open in Spotify” remains available. Page spacing keeps the final rows clear of the preview and pending-changes controls.
- **Playlist creation flow:** Create a public Spotify playlist from selected rows in the current result set, with a name and optional description. No manual arrangement step.

### 5.2 Sidebar folders and playlist columns

- List Liked Songs alongside all playlists returned by Spotify, subject to API visibility. Liked Songs metadata loads automatically; ordinary playlist contents load only when selected.
- Let the user create, rename, reorder, and delete local folders; folder deletion must not delete or unfollow Spotify playlists.
- Let the user assign a playlist to a local folder and move playlists between folders.
- Selecting one or more playlists displays their membership columns and the deduplicated union of their tracks. Folder bulk selection applies the same behavior. Removable playlist chips and a Clear playlist selection action expose the active scope.
- Include individual selection, folder bulk selection, removable selected-source chips, and Clear playlist selection. Clearing selection removes all rows and membership columns, while retaining loaded data in the session cache.
- Search playlist names locally in the sidebar without changing existing selections or making API calls. Show matching children of collapsed folders during search; folder bulk selection applies only to visible matches.
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

- Let the table extend beyond the viewport and scroll through the browser's main vertical scrollbar. Use window-based row virtualization; do not render the entire library into the DOM. Reset vertical table position when search, advanced filters, or the selected source set changes.
- Keep column headers sticky, synchronize header/body horizontal scrolling, and pin track titles while scrolling membership columns horizontally. Reordering columns must not change source selection or reset vertical scroll.
- Drag playlist-header grips to reorder membership columns; focused grips also support Left/Right arrow keys. Remember order independently of session-only playlist selection. Metadata columns retain their positions.
- Clicking a playlist column heading toggles confirmed-membership ascending (non-members first) and descending (members first), with a visible direction indicator and matching toolbar sort state.
- Clicking a membership checkbox stages an addition/removal locally. Save changes applies all drafts in per-playlist batches of up to 100 items, or 40 items for Liked Songs; Discard changes and toggling back make no API calls. Pending removals remain in view until saved.
- Show pending counts and per-playlist addition/removal summaries, save progress/errors, and a 15-second Undo action after Save. Preserve partial save/Undo progress and reconcile uncertain writes before retries.
- Prevent duplicate additions when the item is already present. Preserve intentional duplicates unless membership is explicitly unchecked; removal then deletes every occurrence. Row membership means “present at least once.”
- Serialize Save/Undo operations, disable edits while they run, retain failed drafts, and reconcile uncertain outcomes before retrying. Ordinary-playlist Undo checks snapshots and contents; Liked Songs uses saved-membership checks. Re-liking restores membership but receives a new library-added date from Spotify.
- Refresh updates source data and membership state.
- Use pagination or virtualization for large libraries so the interface stays responsive.

### 5.4 Search, filter, and sort

The filter builder should take inspiration from Obsidian Bases rather than attempting to reproduce all of it:

- Each condition has a property, operator, and value.
- Support nested groups using **All / AND**, **Any / OR**, and **None / NOT** semantics.
- Allow composing groups such as `Artist is X AND (Playlist A OR Playlist B)`.
- Sidebar playlist selection supplies an automatic ANY/OR membership scope, separate from the advanced filter tree. Search and advanced filters combine with that scope by AND. Clear advanced filters leaves the sidebar selection intact.
- Implement filters for loaded playlist membership, artist/creator, album/show, library-added date, saved state, item type, explicit content, and duration in seconds. Saved/date filters are unavailable until automatic saved metadata has loaded successfully.
- Search title, artist, and album/show; search combines with filters by AND.
- Sort by title, artist, album, library-added date, and playlist membership, with ascending/descending direction. Use Spotify URI as the final stable tie-breaker; missing values stay last. Membership sorting uses confirmed data, not unsaved checkbox drafts.
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
- Clear row selections when they leave the result set. Freeze selected URIs and their current order when creation begins.
- Create a public playlist by default, with editable name and optional description.
- Add selected Spotify URIs in the table's deterministic current order (e.g. current sort order); no separate arrangement UI.
- Display progress and a link to open the new playlist in Spotify.
- Add items in batches of at most 100. Preserve the created playlist link and confirmed progress on failure, including when the dialog closes. Resume only after reconciling remote contents; an unknown playlist-creation outcome requires inspection in Spotify before starting another creation.

### 5.7 Refresh and synchronization

- Fetch account information, playlist-list metadata, and saved-track metadata on app open, with no playlist selection restored. Liked Songs is available in the sidebar once loaded.
- Add a prominent manual **Refresh** button.
- Refresh the playlist list, saved-track metadata, and selected ordinary playlist contents. Cache unselected loaded ordinary playlists in memory when their snapshots remain current. Liked Songs shares selection, sorting, filtering, column order, and staged Save/Undo controls with ordinary playlists; use saved-library endpoints for its edits.
- Display loading state, last successful refresh time, and actionable errors (expired authorization, denied scope, inaccessible playlist, or rate limiting).
- Avoid destructive local caching: Spotify is the source of truth for library/playlists; app folders/preferences remain local.
- After Save, update confirmed membership from successful batches. Failed drafts remain pending; Undo is a compensating batch with snapshot/content checks and progress tracking. Require saving or explicit discard before Refresh/disconnect, and warn before leaving with drafts.

### 5.8 Rate limits and quota exhaustion

- Stop immediately on HTTP 429. Do not automatically retry the failed request or resume queued jobs after the cooldown expires; further attempts require user action.
- Distinguish ordinary rate limiting from Spotify's `QUOTA_EXCEEDED` reason. Show the last response reason, endpoint, message, retry deadline, and countdown without exposing authorization tokens.
- Honor a browser-readable `Retry-After` value, preserve the longest recorded cooldown, and block new/queued Web API calls until it expires. Persist this state across reloads and share it across tabs using the same Client ID and origin.
- If `Retry-After` is missing or unavailable to browser JavaScript, use a local safeguard of 15 minutes for quota exhaustion or 60 seconds for other 429 responses. Label these as app pauses, not estimates of Spotify's reset time.
- A successful request to the previously blocked endpoint clears the expired cooldown banner. Local draft editing and Discard remain possible without API calls. The app cannot reset Spotify's quota or coordinate usage by other applications outside this deployment.

## 6. Technical approach

### 6.1 Stack

- React 19 + TypeScript, Vite, and npm; Node.js 22.12+ with Node 24 used in CI.
- Radix UI dialogs, TanStack Table, TanStack Virtual's window virtualizer, and Lucide icons. Native drag controls and keyboard arrows reorder playlist columns.
- Spotify Web API for library, playlists, tracks, and playlist mutations.
- Browser local storage for preferences, tokens, and cooldowns; in-memory Spotify data and edit state. No backend or database is required.

### 6.2 Authentication and deployment

- Each deployment has its own Spotify application Client ID and configured redirect URI.
- Use Authorization Code with PKCE, random verifier/state validation, callback URL cleanup, token refresh, and coalescing of concurrent refresh attempts. Scopes are `user-library-read`, `user-library-modify`, `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, and `playlist-modify-private`.
- Never commit credentials or tokens. Provide `.env.example`, setup instructions, and safe local secret handling.
- Keep the app single-user-per-instance. Document callback URL configuration and deployment configuration.
- Deploy a static SPA at the domain root. Configure Client ID and redirect URI at build time; never provide a client secret. Use `http://127.0.0.1:5173/callback` locally and HTTPS in production, with an SPA fallback to `index.html` for `/callback` and other application paths. `public/_redirects` supplies the Netlify-style fallback.
- Include a logout/disconnect action that clears local tokens.

### 6.3 Data and API layer

- Isolate Spotify calls behind typed client/services, not inside table components.
- Normalize playlist items and saved tracks into a common row model keyed by Spotify URI.
- Track per-playlist capabilities (`readable`, `editable`, `reason`) so inaccessible content and read-only membership are represented explicitly.
- Represent source access as unloaded, loading, readable, inaccessible, or failed. Limit concurrent API requests to three, paginate collections, support cancellation, retry authorization once after refresh, and never automatically retry a 429.
- Use current `/playlists/{id}/items` endpoints for ordinary playlists. Use `/me/tracks` to load Liked Songs and `/me/library/contains` plus `PUT`/`DELETE /me/library` with URI query parameters for its membership edits, in batches of at most 40. Accept empty successful library-write responses.
- Keep Spotify-provided artwork/metadata in original form with links back to Spotify content as required by Spotify's developer policies.
- Treat preview URLs as optional and ephemeral; use Spotify web URLs for fallback links.

### 6.4 Implemented module boundaries

- `auth.ts`: PKCE, token lifecycle, granted scopes, and connection configuration.
- `spotify.ts` and `usePlaylistLibrary.ts`: bounded transport, discovery, pagination, automatic saved metadata, on-demand ordinary playlist loading, cancellation, and session caching.
- `model.ts`, `filters.ts`, and `FilterEditor.tsx`: normalized sources/rows, preferences, remembered column order, recursive filter state, evaluation, and sorting.
- `batchEdits.ts` and `likedEdits.ts`: draft state, batched writes, partial outcomes, membership reconciliation, and Undo.
- `operations.ts`: public playlist creation, confirmed batch progress, and recovery.
- `LibraryTable.tsx` and `Sidebar.tsx`: window virtualization, sticky/pinned columns, drag/keyboard ordering, header sorting, local playlist search, and folders.
- `rateLimit.ts` and `useRateLimit.ts`: persisted cooldown gate and diagnostic countdown.
- `App.tsx`: workspace composition, preview, settings, source selection, save/discard controls, and draft protection.

## 7. Implementation phases

Phases 0–5 and the local implementation in Phase 6 are complete. The lists below describe the delivered milestones, not pending architecture decisions. Environment-specific checks remain in section 11.

### Phase 0 — Repository foundation (implemented)

- Initialize React + TypeScript + Vite project structure.
- Add environment example, ignored secrets, README setup, lint/type-check/build scripts, and basic app shell.
- Document static deployment and exact Spotify redirect URI setup.

### Phase 1 — Spotify connection and data loading (implemented)

- Implement user authorization and secure token lifecycle.
- Read the playlist list with pagination; load ordinary playlist contents on selection and saved-track metadata automatically.
- Load playlist items where permitted and record inaccessible/read-only states.
- Normalize/deduplicate the unified dataset.
- Add open-time refresh, manual Refresh button, loading/error states, and refresh timestamp.

### Phase 2 — Core library table (implemented)

- Build the table with search, basic metadata columns, liked state, and date-added data.
- Add dynamic playlist membership columns based on sidebar selection.
- Handle empty states, large data sets, missing items, episodes, and horizontal scrolling.
- Extend the virtualized table down the page, with synchronized sticky headers and fixed preview controls.

### Phase 3 — Bases-inspired filtering and sorting (implemented)

- Implement property/operator/value conditions.
- Add nested AND/OR/NOT groups and filters for playlist membership, artist, album, date range, liked state, and item type.
- Add initial sort choices and clear active filters.
- Toggle membership sorting by clicking playlist column headings and preserve stable row order within ties.
- Keep saved named views out of the first release.

### Phase 4 — Playlist sidebar and local folders (implemented)

- Build playlist tree/list and selection behavior.
- Implement create/rename/reorder/delete for local folders and playlist assignment/movement.
- Persist local folder data and playlist-column preferences.
- Surface disabled playlists with clear access explanations.
- Add local sidebar search, Liked Songs, drag/keyboard column ordering, and separate persisted order from session-only selection.

### Phase 5 — Mutations, Undo, and playlist creation (implemented)

- Stage additions/removals for editable playlists and apply them through Save changes using batched writes.
- Add mutation progress/errors and Undo.
- Build selected-track playlist creation flow with public default and Spotify link after creation.
- Reconcile UI state with remote response and handle partial failures.
- Support saved-library edits and Undo for Liked Songs, including reconnection for older grants.

### Phase 6 — Preview and deployment polish (implemented locally; live checks remain)

- Add bottom preview bar with available clip playback and Spotify-link fallback.
- Verify no audio downloading/caching.
- Document self-host setup, Spotify developer app configuration, redirect URLs, environment variables, and deployment.
- Review privacy, token handling, source attribution, and API error behavior.
- Persist and display quota/rate-limit cooldowns without automatic 429 retries.

## 8. Acceptance criteria for the first usable release

1. A self-hoster can configure their own Spotify credentials and connect one account.
2. Startup loads account and playlist-list metadata plus saved-track metadata. Ordinary playlist contents load on demand and are cached in memory.
3. Identical Spotify URIs across selected sources produce one row. Selecting Liked Songs includes saved-only tracks, and its membership column supports staged saving/removal with Undo.
4. The sidebar shows playlists and local folders; selecting playlists adds their membership columns and shows the deduplicated union of their tracks. Clearing playlist selection empties the table; search and advanced filters narrow selected playlists.
5. Inaccessible playlists remain visible but disabled with an explanation; read-only membership cannot be edited.
6. Search covers title, artist, and album/show.
7. The user can build nested AND/OR/NOT filters and sort by the agreed properties.
8. Checkbox edits and Discard send no API requests. Save changes batches pending additions/removals across playlists; Undo reverses successful changes when possible, and partial failures remain recoverable.
9. The user can select filtered results and create a public Spotify playlist, then open it in Spotify.
10. Clicking a row opens the bottom preview bar; an available clip plays, otherwise the Spotify link is offered.
11. The playlist list loads on app open. Manual Refresh reloads only the list and selected contents; saved metadata refreshes automatically, and drafts are protected from silent discard.
12. Local folders/preferences and credentials are not committed to the repository.
13. The table scrolls through the page while rendering only nearby rows; headers and track titles stay aligned during horizontal scrolling, column reordering, and resizing.
14. Sidebar search changes only local navigation visibility. Matching folder bulk selection does not fetch hidden, unselected playlists.
15. Playlist column order persists without restoring source selection, and heading clicks toggle ascending/descending confirmed-membership sorting.
16. A 429 response stops requests, displays diagnostic details, and preserves the cooldown across reloads without automatic retries. Unknown server reset times remain explicitly unknown.

## 9. Risks and mitigations

- **Spotify API access restrictions:** Show inaccessible playlists as disabled; never imply all followed playlist contents can be fetched.
- **Deprecated/missing preview URLs:** Treat clips as optional and provide the Spotify link fallback.
- **Large libraries:** Paginate API calls and virtualize table rows; avoid loading every data page synchronously into the UI.
- **Batched playlist edits:** Use clear loading/error states and Undo; reconcile with Spotify after mutations.
- **Self-host credential setup:** Include a concise setup guide and validate required configuration at startup.
- **Folder mismatch:** Label folders as app-local and avoid suggesting they sync with Spotify.
- **Quota exhaustion:** Loading less data reduces future traffic but cannot reset Spotify's server-side quota. Preserve the cooldown and actual response diagnostics instead of repeatedly probing the API.
- **Liked Songs reversals:** Saved-library edits use membership checks rather than playlist snapshots; re-liking cannot restore the old library-added date. Existing read-only grants require reconnection for editing.

## 10. Product decisions already confirmed

- All playlists returned for the user's library, not only owned playlists.
- App-created sidebar folders organize playlists used as membership columns.
- Only selected readable playlists supply rows. Playlist contents load on demand and are cached in memory. No selection means no rows, and no playlist selection is restored on page load. Saved metadata loads automatically. Selecting the Liked Songs sidebar source includes saved-only tracks in the table.
- AND/OR/NOT nested filtering; global search; no saved views initially.
- Distinct Spotify item identifiers remain separate; identical item URI is deduplicated across sources.
- Checkbox membership stages edits; Save changes batches writes, Discard cancels drafts, and post-save Undo reverses confirmed changes.
- Songs and episodes share the same view.
- Initial sorts: title, artist, album, added date, playlist membership.
- Full-page window virtualization, sticky synchronized headers, pinned titles, draggable/keyboard playlist columns, and header-click membership sort toggling.
- Local sidebar playlist search; filtering the sidebar preserves selection and limits folder bulk actions to visible matches.
- Bottom preview bar, clip when available, Spotify link fallback.
- Automatic account, playlist-list, and saved-track metadata on open; on-demand ordinary playlist contents. Manual Refresh also reloads saved metadata and selected ordinary playlists.
- Global staged Save/Discard, batches of 100 playlist items or 40 liked tracks, and 15-second post-save Undo.
- Persisted 429 cooldowns with quota-specific diagnostics, no automatic retries, and no assumed Spotify reset time when `Retry-After` is unavailable.
- Public playlist creation, no pre-creation track arrangement.
- Single-user self-hosted deployment with each instance's own Spotify credentials.

## 11. Validation and remaining release checks

Latest completed automated validation: **40 unit tests and 14 browser tests passed**, together with `npm run lint`, `npm run typecheck`, and `npm run build`. Unit coverage includes normalization, nested filters, token lifecycle, pagination/cancellation, cooldown persistence, batched save recovery, Liked Songs writes, and Undo. Browser coverage includes empty initial selection with automatic saved metadata, source selection, sidebar search/folders, drag and keyboard column ordering, resizing, header sorting, draft protection, creation recovery, Liked Songs permissions, and a 20,000-row/20-column scrolling fixture.

GitHub Actions runs lint, typecheck, unit tests, the production build, and Chromium browser tests on pushes and pull requests. Browser tests use mocked Spotify responses and an isolated local server on port 5174; they do not modify a real Spotify account.

Before a production release, verify the configured Spotify app's real authorization grants, readable/editable sources, save/Undo behavior on disposable content, preview availability, and the host's HTTPS/callback rewrite. Review refresh timestamp wording: the current stored timestamp records playlist discovery completion rather than completion of every selected source load. Spotify's actual quota reset schedule cannot be verified by mocked tests or inferred from the app's fallback pause.

Deferred work remains named saved views, manual track ordering, Spotify-folder synchronization, additional layouts, saved-episode sourcing, and multi-user/server persistence. Setup and deployment commands are maintained in README.md.

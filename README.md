# Spotify Bases

A personal, self-hostable Spotify library workspace: one row per distinct track or episode, playlist membership columns, nested filters, and direct playlist editing.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended), npm, and your own Spotify developer application. Development Mode requires the app owner to have Spotify Premium. Add your account to the app's authorized users if required by the developer dashboard.

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SPOTIFY_CLIENT_ID` to your Spotify app Client ID. **Do not add a client secret.**
4. Register `http://127.0.0.1:5173/callback` as a redirect URI in the Spotify developer dashboard and keep `VITE_SPOTIFY_REDIRECT_URI` identical.
5. Run `npm run dev` (or `npm.cmd run dev` in PowerShell with script execution disabled) and open **http://127.0.0.1:5173**. Connect with Spotify.

Spotify does not accept `localhost` redirect URIs. Production redirect URIs require HTTPS. Environment changes require restarting Vite.

## Features

- Startup fetches your account, playlist list, and saved-track metadata automatically. The table starts empty. Selecting a playlist loads its contents; deselecting cancels unfinished loading and reselecting reuses the session cache. Distinct Spotify URIs stay separate; original duplicate occurrences are retained internally.
- Liked Songs appears in the sidebar like a playlist, including search, folders, membership columns, header sorting, and column reordering. Sidebar selection shows tracks from any selected playlist and adds their membership columns. With none selected, no rows are shown. Removable playlist chips and Clear playlist selection keep this scope visible. Local folders support renaming, ordering, deletion, assignment, and bulk playlist selection.
- Search title, artist/creator, and album/show. Search and nested All/AND, Any/OR, and None/NOT advanced filters further narrow the selected playlists. Clear advanced filters leaves sidebar selection intact. Sort metadata or playlist membership, resize columns, and hide optional metadata.
- Search playlist names in the sidebar without changing your current selections or sending API requests. Matching playlists inside collapsed folders are shown during search; folder bulk selection affects matching visible playlists only.
- Drag playlist-header grips to rearrange membership columns, or focus a grip and use Left/Right arrows. Column order is remembered while playlist selection still starts empty on reload. Click a playlist heading to toggle membership ascending (non-members first) and descending (members first); sorting uses confirmed membership until pending edits are saved.
- Editable membership checkboxes stage local changes without API calls. Save changes batches all pending edits across playlists in groups of up to 100 items (40 for Liked Songs). Discard changes sends no requests, and toggling back cancels an edit. Unchecking removes **all** occurrences when saved. Pending removals remain visible until Save. Undo is available for 15 seconds after saving and restores duplicate counts/positions when remote contents remain compatible. Partial failures retain unapplied drafts; uncertain outcomes are reconciled before retrying.
- Create an empty **public** playlist, or select rows/all results to include songs in current table order. Hidden selections are cleared. Batched creation retains progress and reconciles ambiguous writes before resuming.
- Click a title or row to immediately show a Spotify embed in the bottom player and request playback when its optional controls are ready. Clicking the same song requests playback again. Switching items reuses the player; closing it destroys the embed. Spotify or browser restrictions can still require pressing Play inside the player; if the iframe API stalls or fails, the standard embed remains available and songs can still be switched. No preview URL, extra Web API lookup, or additional OAuth scope is required. Playback availability depends on Spotify and your browser/session; Open in Spotify is always available. The app does not download or cache audio.
- Refresh reloads the playlist list, saved-track metadata, and selected ordinary playlist contents. Unselected ordinary playlists are not scanned. Unsaved changes must be saved or explicitly discarded before refreshing or disconnecting. Closing the page warns about unsaved edits.

Liked status and library-added dates load automatically and stay synchronized with saved changes. Select Liked Songs to browse saved-only tracks, or combine it with other selected playlists. Its membership column stages saving/removing tracks through the same Save/Discard/Undo workflow. Episodes cannot be added to Liked Songs. Undo can re-like a removed track, but Spotify assigns a new library-added date. Existing connections without saved-library write permission can browse Liked Songs and see a Reconnect to edit Liked Songs button.

Saved episodes are not independently fetched; episodes enter through accessible playlists. No named filter views, manual track ordering, Spotify-folder synchronization, or multi-user backend are included.

## Deploy a static build

Set `VITE_SPOTIFY_CLIENT_ID` and `VITE_SPOTIFY_REDIRECT_URI=https://your-domain.example/callback` **at build time**, then run `npm run build`. Serve `dist/` with HTTPS and rewrite application paths (including `/callback`) to `index.html`. The deployment must be at the domain root. No server-side secrets or database are required. Each deployment should use its own Spotify application credentials.

For Netlify-style hosting, `public/_redirects` supplies the SPA fallback. On other hosts configure the equivalent rewrite. `npm run preview` lets you check the built app locally.

## Storage and access

Authorization uses PKCE with a random verifier and state validation. Tokens persist in local storage until disconnect, so anyone using the browser profile can use the connection. Disconnect clears local tokens; to revoke Spotify authorization use [Spotify app settings](https://www.spotify.com/account/apps/).

Folders, playlist column order, widths, search, and sort are stored in a versioned preference record keyed by Client ID and Spotify account. Playlist selection always starts empty; old persisted selections are ignored. Advanced filters, sidebar playlist search, row selections, drafts, and Undo records are session-only. Library metadata is held in memory and reloaded from Spotify. Settings can reset local organization and display preferences. No analytics or application backend is included.

Scopes: `user-library-read`, `user-library-modify`, `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, and `playlist-modify-private`. Spotify remains the authority for access and edit permissions; 403 errors are surfaced rather than retried.

## Rate limits and development quotas

A 429 response stops the request immediately; it is never automatically retried. The app pauses queued and new Web API calls, persists the cooldown across reloads, and shares it with other tabs on this origin using the same Client ID. The banner shows the response reason, endpoint, and Spotify's `Retry-After` value. Pending edits are retained.

`QUOTA_EXCEEDED` means Spotify's Development Mode quota was exhausted, which differs from the ordinary rolling rate limit. Quotas are shared across Development Mode apps owned by the same developer account. Reducing future requests does not reset an already exhausted quota. See [Spotify's quota documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

When `Retry-After` is missing or not exposed to browser JavaScript, the app applies a conservative local pause of 15 minutes for quota exhaustion or 60 seconds for other 429 responses. These are app safeguards, **not Spotify reset-time estimates**. Once the pause ends, retry manually; the app does not resume jobs automatically. A successful request to the previously blocked endpoint clears the banner. Close older app tabs that may still be running previous retry logic.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest covers normalization, filtering, pagination, authorization retry, rate limits, duplicate removal, Undo conflicts, and partial creation recovery. Playwright uses mocked Spotify responses, including large-library rendering. GitHub Actions runs these checks on pushes and pull requests.

Real-account authorization, playlist mutations, and embedded playback availability still need a smoke test with your configured Spotify app and a disposable playlist. Automated tests never modify a real Spotify account.

## Architecture

`src/auth.ts` owns PKCE and token lifecycle; `src/spotify.ts` owns bounded API transport, pagination, capability loading, and refresh. `src/model.ts` normalizes source records; `src/filters.ts` evaluates the recursive filter AST. `src/usePlaylistLibrary.ts` manages on-demand loading and session caching. `src/batchEdits.ts` stages and saves membership changes and reconciles batch Undo. `src/likedEdits.ts` routes Liked Songs edits to the saved-library API using batches of 40 and membership reconciliation. `src/operations.ts` handles playlist creation recovery. React components render the folder sidebar, filter builder, virtualized table, preview bar, and dialogs.

See [plan.md](plan.md) for product requirements and acceptance criteria.

## Spotify references

- [Current Development Mode migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [PKCE authorization](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
- [Add playlist items](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist)
- [Remove playlist items](https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist)
- [Save library items](https://developer.spotify.com/documentation/web-api/reference/save-library-items)
- [Remove library items](https://developer.spotify.com/documentation/web-api/reference/remove-library-items)

Spotify can list followed playlists without exposing their contents. Preview URLs are nullable and deprecated. App folders are separate from Spotify folders, which are not exposed through the Web API.

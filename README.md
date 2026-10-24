# Spotify Bases

A personal, self-hostable web app for exploring your Spotify library as a filterable table and building focused playlists from tracks you already know.

The main view is inspired by Obsidian Bases: tracks are rows, track metadata and selected playlist memberships are columns, and nested filters help you find exactly the set of songs you want.

## Planned features

- Browse playlists you own or follow, plus tracks saved to your Spotify library.
- See the combined library as one searchable table. The same Spotify track is one row; different recordings/releases remain separate.
- Choose playlist membership columns from the sidebar, with app-managed folders for organizing playlists.
- Filter with nested AND, OR, and NOT groups; sort by title, artist, album, added date, and playlist membership.
- Add or remove a track from an editable playlist immediately, with Undo.
- Create a public playlist from the current selection.
- Preview a 30-second clip when Spotify provides one, or open the track in Spotify.
- Refresh library and playlist data on demand and automatically when the app opens.

## Technology

- React and TypeScript
- Vite for the frontend and local development
- Spotify Web API with per-instance Spotify credentials and user authorization
- Local persistence for app-managed playlist folders and interface preferences

The first deployment target is a single-user self-hosted app. Each person running an instance configures their own Spotify application credentials. No shared user accounts or centralized music database are planned.

## Spotify API limitations

Spotify can list playlists a user owns or follows, but the API may not allow reading every followed playlist's contents. Such playlists will remain visible but disabled with an explanation. Playlist folders are not exposed by the API, so folders in this app are local organization only. Preview URLs may be unavailable; the app falls back to a Spotify link.

## Project plan

See [plan.md](plan.md) for the product requirements, interaction details, architecture, implementation phases, and acceptance criteria.

## Status

Planning. Implementation has not started.

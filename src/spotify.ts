import { accessToken } from './auth';
import {
  LIKED_SONGS_ID,
  likedSongsPlaylist,
  type Library,
  type Occurrence,
  type Playlist,
  type RawItem,
  type SavedTrack,
} from './model';
import { RateLimitGate, rateLimitMessage } from './rateLimit';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export type Requester = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Page<T> = { items: T[]; next: string | null };
export class Spotify {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private token: typeof accessToken = accessToken,
    private transport: typeof fetch = (...args) => fetch(...args),
    readonly rateLimit = new RateLimitGate(),
  ) {}
  private async acquire() {
    if (this.active >= 3) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
      return;
    }
    this.active++;
  }
  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, 'https://api.spotify.com/v1/');
    if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/'))
      throw new Error('Unexpected Spotify pagination URL.');
    this.checkCooldown();
    await this.acquire();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();
        this.checkCooldown();
        const token = await this.token();
        let response: Response;
        try {
          response = await this.transport(url, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal,
          });
        } catch {
          signal?.throwIfAborted();
          throw new ApiError(
            0,
            'Network connection lost. Refresh to reconcile Spotify state.',
            method !== 'GET',
          );
        }
        if (response.status === 401 && attempt === 0) {
          await this.token(true);
          continue;
        }
        if (response.status === 429) {
          const data = await response.json().catch(() => null);
          throw new ApiError(
            429,
            rateLimitMessage(this.rateLimit.record(url.pathname, response, data)),
          );
        }
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new ApiError(
            response.status,
            response.status === 403
              ? 'Spotify denied access. Check app authorization and playlist permissions.'
              : response.status === 429
                ? 'Spotify rate limit reached. Wait and refresh.'
                : (data?.error?.message ?? `Spotify request failed (${response.status}).`),
            method !== 'GET' && response.status >= 500,
          );
        }
        this.rateLimit.markSuccess(url.pathname);
        if (response.status === 204) return undefined as T;
        const content = await response.text();
        return (content.trim() ? JSON.parse(content) : undefined) as T;
      }
      throw new Error('Spotify request could not complete.');
    } finally {
      this.release();
    }
  }
  private checkCooldown() {
    const state = this.rateLimit.read();
    if (state && state.retryAt > Date.now()) throw new ApiError(429, rateLimitMessage(state));
  }
  async pages<T>(path: string, onPage?: (items: T[]) => void, signal?: AbortSignal): Promise<T[]> {
    const all: T[] = [];
    let next: string | null = path;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new Error('Spotify returned a repeated pagination URL.');
      seen.add(next);
      const page: Page<T> = await this.request(next, 'GET', undefined, signal);
      const items = page.items.filter(Boolean);
      all.push(...items);
      onPage?.(items);
      next = page.next;
    }
    return all;
  }
  async playlist(id: string, signal?: AbortSignal): Promise<Playlist> {
    if (id === LIKED_SONGS_ID)
      return likedSongsPlaylist(
        await this.pages<SavedTrack>('me/tracks?limit=50', undefined, signal),
      );
    const raw = await this.request<Playlist>(`playlists/${id}`, 'GET', undefined, signal);
    const occurrences: Occurrence[] = [];
    await this.pages<{ item?: RawItem | null; track?: RawItem | null; added_at: string | null }>(
      `playlists/${id}/items?limit=50&additional_types=track,episode`,
      (items) => {
        for (const entry of items) {
          const item = entry.item ?? entry.track ?? null;
          occurrences.push({
            uri: item?.uri ?? null,
            item,
            position: occurrences.length,
            addedAt: entry.added_at,
          });
        }
      },
      signal,
    );
    const after = await this.request<Playlist>(`playlists/${id}`, 'GET', undefined, signal);
    if (raw.snapshot_id !== after.snapshot_id)
      throw new Error('Playlist changed while loading. Refresh to retry.');
    return { ...after, access: 'readable', editable: false, occurrences };
  }
  async library(onProgress: (library: Library, status: string) => void): Promise<Library> {
    const account = await this.request<Library['account']>('me');
    const state: Library = { account, playlists: [], saved: [], savedLoaded: false, errors: [] };
    state.playlists = (await this.pages<Playlist>('me/playlists?limit=50')).map((p) => ({
      ...p,
      access: 'unloaded',
      editable: p.owner.id === account.id || p.collaborative,
      occurrences: [],
    }));
    state.refreshedAt = new Date().toISOString();
    onProgress(state, 'Playlist list ready');
    return state;
  }
}
export const spotify = new Spotify();

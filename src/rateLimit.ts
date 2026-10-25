import { clientId } from './auth';
export type RateLimitState = {
  reason: 'QUOTA_EXCEEDED' | 'RATE_LIMITED';
  retryAt: number;
  receivedAt: number;
  retryAfterSeconds: number | null;
  path: string;
  serverMessage: string;
};
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const key = `spotify-bases:cooldown:${clientId}`;
function browserStore(): Store | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return;
  }
}
export class RateLimitGate {
  private state: RateLimitState | null = null;
  private listeners = new Set<(state: RateLimitState | null) => void>();
  constructor(private store: Store | undefined = browserStore()) {
    this.read();
    if (typeof window !== 'undefined')
      window.addEventListener('storage', (event) => {
        if (event.key === key) {
          if (event.newValue === 'null') {
            this.state = null;
            this.listeners.forEach((listener) => listener(null));
          } else this.read();
        }
      });
  }
  read() {
    try {
      const value = JSON.parse(this.store?.getItem(key) ?? 'null');
      if (
        value &&
        Number.isFinite(value.retryAt) &&
        Number.isFinite(value.receivedAt) &&
        ['QUOTA_EXCEEDED', 'RATE_LIMITED'].includes(value.reason) &&
        typeof value.path === 'string' &&
        typeof value.serverMessage === 'string'
      ) {
        if (JSON.stringify(value) !== JSON.stringify(this.state)) {
          this.state = value;
          this.listeners.forEach((listener) => listener(this.state));
        }
      }
    } catch {
      /* Storage is optional; in-memory protection remains active. */
    }
    return this.state;
  }
  subscribe = (listener: (state: RateLimitState | null) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  markSuccess(path: string) {
    const state = this.read();
    if (state && state.retryAt <= Date.now() && state.path === path) {
      this.state = null;
      try {
        this.store?.setItem(key, 'null');
      } catch {
        /* optional persistence */
      }
      this.listeners.forEach((listener) => listener(null));
    }
  }
  record(
    path: string,
    response: Response,
    data: { error?: { reason?: string; message?: string } } | null,
  ) {
    const receivedAt = Date.now(),
      raw = response.headers.get('Retry-After');
    const seconds = raw !== null && raw.trim() !== '' ? Number(raw) : NaN;
    const date = raw && !Number.isFinite(seconds) ? Date.parse(raw) : NaN;
    const retryAfterSeconds =
      Number.isFinite(seconds) && seconds >= 0
        ? seconds
        : Number.isFinite(date)
          ? Math.max(0, (date - receivedAt) / 1000)
          : null;
    const reason = data?.error?.reason === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED';
    // These fallbacks are app pauses, not claims about Spotify's unknown reset time.
    const wait = retryAfterSeconds ?? (reason === 'QUOTA_EXCEEDED' ? 900 : 60);
    this.state = {
      reason,
      receivedAt,
      retryAfterSeconds,
      retryAt: Math.max(this.read()?.retryAt ?? 0, receivedAt + Math.max(1, wait) * 1000),
      path,
      serverMessage: data?.error?.message ?? 'Too many requests',
    };
    try {
      this.store?.setItem(key, JSON.stringify(this.state));
    } catch {
      /* keep the pause in memory */
    }
    this.listeners.forEach((listener) => listener(this.state));
    return this.state;
  }
}
export function rateLimitMessage(state: RateLimitState) {
  const cause =
    state.reason === 'QUOTA_EXCEEDED'
      ? 'Spotify development quota exceeded'
      : 'Spotify rate limit reached';
  const timing =
    state.retryAfterSeconds === null
      ? 'Retry-After was unavailable to this browser. Spotify’s reset time is unknown. This app has paused requests'
      : `Spotify returned Retry-After: ${state.retryAfterSeconds} seconds. Requests are paused`;
  return `${cause}. ${timing} until ${new Date(state.retryAt).toLocaleString()}. No automatic retries.`;
}

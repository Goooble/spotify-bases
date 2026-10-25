import { useCallback, useEffect, useRef } from 'react';
import type { LibraryItem } from './model';

type Controller = {
  loadEntity: (uri: string) => void;
  play: () => void;
  destroy: () => void;
  addListener: (event: 'ready', callback: () => void) => void;
};
type EmbedApi = {
  createController: (
    element: HTMLElement,
    options: { uri: string; width: string; height: number },
    callback: (controller: Controller) => void,
  ) => void;
};
declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: EmbedApi) => void;
    spotifyBasesEmbedApi?: EmbedApi;
    spotifyBasesEmbedApiPromise?: Promise<EmbedApi>;
  }
}
function loadApi() {
  if (window.spotifyBasesEmbedApi) return Promise.resolve(window.spotifyBasesEmbedApi);
  if (!window.spotifyBasesEmbedApiPromise) {
    window.spotifyBasesEmbedApiPromise = new Promise<EmbedApi>((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = window.setTimeout(fail, 10000);
      function fail() {
        window.clearTimeout(timeout);
        script.remove();
        window.spotifyBasesEmbedApiPromise = undefined;
        reject(new Error('Spotify player controls could not load.'));
      }
      script.src = 'https://open.spotify.com/embed/iframe-api/v1';
      script.async = true;
      window.onSpotifyIframeApiReady = (api) => {
        window.clearTimeout(timeout);
        window.spotifyBasesEmbedApi = api;
        resolve(api);
      };
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return window.spotifyBasesEmbedApiPromise;
}

function plainEmbed(item: LibraryItem) {
  const frame = document.createElement('iframe');
  frame.title = `Spotify player: ${item.title}`;
  frame.src = `https://open.spotify.com/embed/${item.type}/${encodeURIComponent(item.uri.split(':')[2])}`;
  frame.width = '100%';
  frame.height = '152';
  frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  return frame;
}

export default function SpotifyEmbed({ item }: { item: LibraryItem }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(item);
  const controller = useRef<Controller | undefined>(undefined);
  const ready = useRef(false);
  const loadedUri = useRef(item.uri);

  const requestPlayback = useCallback(() => {
    const current = latest.current;
    if (!controller.current) {
      if (loadedUri.current !== current.uri) {
        host.current?.replaceChildren(plainEmbed(current));
        loadedUri.current = current.uri;
      }
      return;
    }
    const iframe = host.current?.querySelector('iframe');
    if (iframe) iframe.title = `Spotify player: ${current.title}`;
    try {
      if (loadedUri.current !== current.uri) {
        controller.current.loadEntity(current.uri);
        loadedUri.current = current.uri;
      }
      if (ready.current) controller.current.play();
    } catch {
      controller.current.destroy();
      controller.current = undefined;
      ready.current = false;
      host.current?.replaceChildren(plainEmbed(current));
      loadedUri.current = current.uri;
    }
  }, []);

  useEffect(() => {
    latest.current = item;
    requestPlayback();
  }, [item, requestPlayback]);

  useEffect(() => {
    let disposed = false;
    const container = host.current!;
    // Render first: the optional control script must never gate a usable player.
    container.replaceChildren(plainEmbed(latest.current));
    loadedUri.current = latest.current.uri;
    loadApi()
      .then((api) => {
        if (disposed) return;
        const mount = container.firstElementChild as HTMLElement;
        loadedUri.current = latest.current.uri;
        api.createController(
          mount,
          { uri: latest.current.uri, width: '100%', height: 152 },
          (embed) => {
            if (disposed) {
              embed.destroy();
              return;
            }
            controller.current = embed;
            const frame = container.querySelector('iframe');
            if (frame) frame.title = `Spotify player: ${latest.current.title}`;
            embed.addListener('ready', () => {
              if (disposed || ready.current) return;
              ready.current = true;
              requestPlayback();
            });
          },
        );
      })
      .catch(() => {
        if (!disposed) {
          controller.current?.destroy();
          controller.current = undefined;
          ready.current = false;
          container.replaceChildren(plainEmbed(latest.current));
          loadedUri.current = latest.current.uri;
        }
      });
    return () => {
      disposed = true;
      ready.current = false;
      controller.current?.destroy();
      controller.current = undefined;
      container.replaceChildren();
    };
  }, [requestPlayback]);

  return (
    <div className="spotify-embed">
      <div ref={host} />
    </div>
  );
}

import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://open.spotify.com/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<button>Play in Spotify</button>' }),
  );
  await page.route('https://open.spotify.com/embed/iframe-api/v1', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
      window.embedCalls = [];
      window.onSpotifyIframeApiReady({ createController(mount, options, callback) {
        const frame = document.createElement('iframe');
        frame.setAttribute('allow', 'autoplay; encrypted-media');
        const load = (uri) => {
          frame.src = 'https://open.spotify.com/embed/' + uri.split(':').slice(1).join('/');
          window.embedCalls.push(['load', uri]);
        };
        load(options.uri);
        mount.replaceWith(frame);
        callback({
          loadEntity: load,
          play() { window.embedCalls.push(['play']); },
          destroy() { window.embedCalls.push(['destroy']); frame.remove(); },
          addListener(event, listener) { if (event === 'ready') setTimeout(listener, window.embedReadyDelay || 0); },
        });
      }});
    `,
    }),
  );
});
async function mockSpotify(page: Page, count = 3, playlistCount = 2, writeLiked = true) {
  await page.addInitScript(
    (writeLiked) =>
      localStorage.setItem(
        'spotify-bases:tokens:test-client',
        JSON.stringify({
          access_token: 'test',
          refresh_token: 'refresh',
          scope: writeLiked ? 'user-library-read user-library-modify' : 'user-library-read',
          expiresAt: Date.now() + 3600000,
        }),
      ),
    writeLiked,
  );
  const requests: { path: string; method: string }[] = [];
  const lists = new Map(
    Array.from({ length: playlistCount }, (_, i) => [
      i === 0 ? 'p' : `p${i}`,
      {
        name: i === 0 ? 'My playlist' : `Playlist ${i}`,
        members:
          i === 0
            ? count > 4
              ? Array.from({ length: count }, (_, n) => (n === 0 ? 'a' : n === 1 ? 'b' : String(n)))
              : ['a', 'b']
            : ['b', '2'],
        snapshot: 0,
      },
    ]),
  );
  const liked = new Map(
    Array.from({ length: count }, (_, i) => [
      i === 0 ? 'a' : i === 1 ? 'b' : String(i),
      '2026-01-01',
    ]),
  );
  liked.set('saved-only', '2026-01-01');
  const created: string[] = [];
  let fail = false;
  let failCreation = false;
  const item = (id: string) => ({
    uri: `spotify:track:${id}`,
    type: 'track',
    name: id === 'a' ? 'Alpha' : id === 'b' ? 'Beta' : `Track ${id}`,
    artists: [{ name: id === 'a' ? 'One' : 'Two' }],
    album: { name: 'Album' },
    duration_ms: 180000,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  });
  const metadata = (id: string) => {
    const p = lists.get(id)!;
    return {
      id,
      name: p.name,
      owner: { id: 'me' },
      collaborative: false,
      snapshot_id: String(p.snapshot),
      external_urls: { spotify: `https://open.spotify.com/playlist/${id}` },
    };
  };
  await page.route('https://api.spotify.com/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.slice(4),
      method = request.method(),
      body = request.postDataJSON();
    requests.push({ path, method });
    let data: unknown = {};
    if (path === 'me') data = { id: 'me', display_name: 'Test listener' };
    else if (path === 'me/playlists' && method === 'POST')
      data = { id: 'new', external_urls: { spotify: 'https://open.spotify.com/playlist/new' } };
    else if (path === 'me/playlists')
      data = {
        items: [
          ...[...lists.keys()].map(metadata),
          {
            id: 'unavailable',
            name: 'Followed playlist',
            owner: { id: 'other' },
            collaborative: false,
            snapshot_id: '0',
          },
        ],
        next: null,
      };
    else if (path === 'me/tracks')
      data = {
        items: [...liked.entries()].map(([id, added_at]) => ({ added_at, track: item(id) })),
        next: null,
      };
    else if (path === 'me/library/contains') {
      data = (new URL(request.url()).searchParams.get('uris') ?? '')
        .split(',')
        .map((uri) => liked.has(uri.split(':')[2]));
    } else if (path === 'me/library') {
      const ids = (new URL(request.url()).searchParams.get('uris') ?? '')
        .split(',')
        .map((uri) => uri.split(':')[2]);
      if (method === 'PUT') ids.forEach((id) => liked.set(id, new Date().toISOString()));
      else ids.forEach((id) => liked.delete(id));
      await route.fulfill({ status: 200, body: '' });
      return;
    } else if (path.startsWith('playlists/unavailable')) {
      await route.fulfill({ status: 403, json: { error: { message: 'Denied' } } });
      return;
    } else if (path === 'playlists/new')
      data = {
        id: 'new',
        name: 'New',
        owner: { id: 'me' },
        collaborative: false,
        snapshot_id: 'new',
      };
    else if (path === 'playlists/new/items') {
      if (method === 'POST') {
        if (failCreation && created.length >= 100) {
          failCreation = false;
          await route.fulfill({ status: 503, json: { error: { message: 'Temporary failure' } } });
          return;
        }
        created.push(...body.uris);
        data = { snapshot_id: 'new' };
      } else
        data = {
          items: created.map((uri) => ({ item: item(uri.split(':')[2]), added_at: null })),
          next: null,
        };
    } else if (path.startsWith('playlists/')) {
      const id = path.split('/')[1],
        p = lists.get(id)!;
      if (!path.endsWith('/items')) data = metadata(id);
      else if (method === 'GET')
        data = {
          items: p.members.map((id) => ({ item: item(id), added_at: '2025-01-01' })),
          next: null,
        };
      else {
        if (fail) {
          await route.fulfill({ status: 403, json: { error: { message: 'Denied' } } });
          return;
        }
        if (method === 'DELETE') {
          const remove = new Set(body.items.map((i: { uri: string }) => i.uri));
          p.members = p.members.filter((id) => !remove.has(item(id).uri));
        } else
          p.members.splice(
            body.position ?? p.members.length,
            0,
            ...body.uris.map((uri: string) => uri.split(':')[2]),
          );
        data = { snapshot_id: String(++p.snapshot) };
      }
    }
    await route.fulfill({ json: data });
  });
  return {
    requests,
    liked,
    setLiked: (ids: string[]) => {
      liked.clear();
      ids.forEach((id) => liked.set(id, '2026-01-01'));
    },
    created,
    failEdits: () => {
      fail = true;
    },
    allowEdits: () => {
      fail = false;
    },
    failCreationBatch: () => {
      failCreation = true;
    },
  };
}
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.workspace-footer [role="status"]')).toContainText(
    'Playlist list ready',
    { timeout: 30000 },
  );
  await expect(
    page
      .locator('aside label')
      .filter({ has: page.getByRole('checkbox', { name: 'Liked Songs', exact: true }) }),
  ).toContainText(/\d+ items/, { timeout: 30000 });
}
async function select(page: Page, name = 'My playlist') {
  await page.getByRole('checkbox', { name, exact: true }).check();
  await expect(
    page.getByRole('button', { name: `Remove ${name} from playlist selection`, exact: true }),
  ).toBeAttached();
}
const writes = (requests: { method: string }[]) => requests.filter((r) => r.method !== 'GET');

test('disconnected screen offers Spotify connection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect with Spotify' })).toBeVisible();
});

test('playlist headers toggle membership sorting and support drag and keyboard reordering', async ({
  page,
}) => {
  const mock = await mockSpotify(page);
  await ready(page);
  await select(page);
  await select(page, 'Playlist 1');
  const header = page.getByLabel('Library column headers scroll area');
  const before = mock.requests.length;
  await header.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await header
    .getByRole('button', { name: 'Sort My playlist membership ascending', exact: true })
    .click();
  const titles = page.locator('tbody tr[data-index] .track-title');
  await expect(titles).toHaveText(['Track 2Track', 'AlphaTrack', 'BetaTrack']);
  await expect(header.locator('th[data-playlist-id="p"]')).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await header
    .getByRole('button', { name: 'Sort My playlist membership descending', exact: true })
    .click();
  await expect(titles).toHaveText(['AlphaTrack', 'BetaTrack', 'Track 2Track']);
  await expect(page.getByRole('combobox', { name: 'Sort by', exact: true })).toHaveValue(
    'membership:p',
  );
  const column = header.locator('th[data-playlist-id="p"]');
  const oldWidth = (await column.boundingBox())!.width;
  const resize = (await column.locator('.resizer').boundingBox())!;
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 36, resize.y + resize.height / 2);
  await page.mouse.up();
  await expect.poll(async () => (await column.boundingBox())!.width).toBeCloseTo(oldWidth + 36, 0);
  await expect(column).toHaveAttribute('aria-sort', 'descending');
  await header
    .getByRole('button', { name: 'Move Playlist 1 column', exact: true })
    .dragTo(header.locator('th[data-playlist-id="p"]'));
  await expect
    .poll(() =>
      header
        .locator('th[data-playlist-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-playlist-id'))),
    )
    .toEqual(['p1', 'p']);
  await expect(header.locator('th[data-playlist-id="p"]')).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await header
    .getByRole('button', { name: 'Move Playlist 1 column', exact: true })
    .press('ArrowRight');
  await expect
    .poll(() =>
      header
        .locator('th[data-playlist-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-playlist-id'))),
    )
    .toEqual(['p', 'p1']);
  await header
    .getByRole('button', { name: 'Move Playlist 1 column', exact: true })
    .press('ArrowLeft');
  expect(mock.requests).toHaveLength(before);
  await expect
    .poll(() =>
      page
        .locator('tbody tr[data-index]')
        .first()
        .locator('td[headers^="library-column-playlist:"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('headers'))),
    )
    .toEqual(['library-column-playlist:p1', 'library-column-playlist:p']);
  await page.reload();
  await expect(page.getByRole('status').first()).toContainText('Playlist list ready');
  await select(page);
  await select(page, 'Playlist 1');
  await expect
    .poll(() =>
      header
        .locator('th[data-playlist-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-playlist-id'))),
    )
    .toEqual(['p1', 'p']);
});

test('sidebar search keeps selections and only bulk-selects matching folder playlists', async ({
  page,
}) => {
  const mock = await mockSpotify(page, 3, 3);
  await ready(page);
  await select(page);
  const search = page.getByRole('textbox', { name: 'Search playlists', exact: true });
  const sidebar = page.locator('aside');
  const before = mock.requests.length;
  await search.fill('PLAYLIST 2');
  await expect(sidebar.getByRole('checkbox', { name: 'Playlist 2', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('checkbox', { name: 'My playlist', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove My playlist from playlist selection', exact: true }),
  ).toBeVisible();
  expect(mock.requests).toHaveLength(before);
  await search.fill('no matching playlist');
  await expect(page.getByText('No playlists match your search.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear playlist search', exact: true }).click();
  await expect(sidebar.getByRole('checkbox', { name: 'My playlist', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Create local folder', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Evening');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const folderId = await page
    .getByRole('combobox', { name: 'Move Playlist 1 to folder' })
    .locator('option')
    .filter({ hasText: 'Evening' })
    .getAttribute('value');
  for (const name of ['Playlist 1', 'Playlist 2'])
    await page.getByRole('combobox', { name: `Move ${name} to folder` }).selectOption(folderId!);
  await page.getByRole('button', { name: 'Collapse Evening', exact: true }).click();
  await search.fill('Playlist 1');
  await expect(sidebar.getByRole('checkbox', { name: 'Playlist 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle playlists in Evening', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove Playlist 1 from playlist selection', exact: true }),
  ).toBeVisible();
  expect(mock.requests.some((r) => r.path.startsWith('playlists/p2'))).toBe(false);
  await page.getByRole('button', { name: 'Clear playlist search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Evening', exact: true })).toBeVisible();
});

test('quota responses stop requests and preserve the cooldown across reloads', async ({ page }) => {
  const mock = await mockSpotify(page);
  let blocked = 0;
  await page.route('https://api.spotify.com/v1/me', async (route) => {
    blocked++;
    await route.fulfill({
      status: 429,
      headers: { 'Retry-After': '7200', 'Access-Control-Expose-Headers': 'Retry-After' },
      json: { error: { status: 429, reason: 'QUOTA_EXCEEDED', message: 'Too many requests' } },
    });
  });
  await page.goto('/');
  const banner = page.getByRole('status', { name: 'Spotify access cooldown' });
  await expect(banner).toContainText('Spotify development quota exceeded');
  await expect(banner).toContainText('Retry-After: 7200 seconds');
  await expect(banner).toContainText('No automatic retries');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  await page.reload();
  await expect(banner).toContainText('QUOTA_EXCEEDED');
  expect(blocked).toBe(1);
  expect(mock.requests).toHaveLength(0);
});

test('startup loads saved metadata automatically while ordinary playlists stay on demand', async ({
  page,
}) => {
  const mock = await mockSpotify(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'spotify-bases:preferences:test-client:me',
      JSON.stringify({ version: 1, columns: ['p'], folders: [] }),
    ),
  );
  await ready(page);
  await expect(
    page.getByText('Select playlists to load their tracks', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'My playlist', exact: true })).not.toBeChecked();
  expect(mock.requests.map((r) => r.path)).toEqual(['me', 'me/playlists', 'me/tracks']);
  await select(page);
  const fetched = mock.requests.filter((r) => r.path === 'playlists/p/items').length;
  expect(fetched).toBe(1);
  expect(mock.requests.some((r) => r.path.startsWith('playlists/p1'))).toBe(false);
  await page.getByRole('button', { name: 'Clear playlist selection', exact: true }).click();
  await expect(
    page.getByText('Select playlists to load their tracks', { exact: true }),
  ).toBeVisible();
  await select(page);
  expect(mock.requests.filter((r) => r.path === 'playlists/p/items')).toHaveLength(fetched);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(() => mock.requests.filter((r) => r.path === 'playlists/p/items').length)
    .toBe(fetched + 1);
  expect(mock.requests.some((r) => r.path.startsWith('playlists/p1'))).toBe(false);
});

test('Liked Songs behaves as a playlist with staged saves and Undo', async ({ page }) => {
  const mock = await mockSpotify(page);
  mock.setLiked(['a', 'saved-only']);
  await ready(page);
  expect(mock.requests.filter((r) => r.path === 'me/tracks')).toHaveLength(1);
  await expect(page.getByRole('checkbox', { name: 'Liked Songs', exact: true })).not.toBeChecked();
  await select(page);
  await expect(page.getByRole('button', { name: 'Track saved-only', exact: true })).toHaveCount(0);
  await select(page, 'Liked Songs');
  await expect(page.getByRole('button', { name: 'Track saved-only', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr[data-index]')).toHaveCount(3);
  const beta = page.getByRole('checkbox', { name: 'Beta in Liked Songs', exact: true });
  const alpha = page.getByRole('checkbox', { name: 'Alpha in Liked Songs', exact: true });
  const before = mock.requests.length;
  await beta.check();
  await alpha.uncheck();
  expect(mock.requests).toHaveLength(before);
  await page.getByRole('button', { name: 'Save changes (2)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  expect([...mock.liked.keys()].sort()).toEqual(['b', 'saved-only']);
  const betaRow = page
    .locator('tbody tr[data-index]')
    .filter({ has: page.getByRole('button', { name: 'Beta', exact: true }) });
  await expect(betaRow.locator('td[headers="library-column-saved"]')).toHaveText('♥');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(alpha).toBeChecked();
  await expect(beta).not.toBeChecked();
  expect([...mock.liked.keys()].sort()).toEqual(['a', 'saved-only']);
  await page
    .getByRole('button', { name: 'Remove My playlist from playlist selection', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: '+ Condition', exact: true }).click();
  await expect(page.getByLabel('Filter property').locator('option[value="saved"]')).toBeEnabled();
});

test('old connections can browse Liked Songs and are offered reconnection for editing', async ({
  page,
}) => {
  await mockSpotify(page, 3, 2, false);
  await ready(page);
  await select(page, 'Liked Songs');
  await expect(
    page.getByRole('checkbox', { name: 'Alpha in Liked Songs', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Reconnect to edit Liked Songs', exact: true }),
  ).toBeVisible();
});

test('deselecting a loading playlist cancels before requesting track pages', async ({ page }) => {
  const mock = await mockSpotify(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route('https://api.spotify.com/v1/playlists/p', async (route) => {
    started = true;
    await gate;
    await route
      .fulfill({
        json: {
          id: 'p',
          name: 'My playlist',
          owner: { id: 'me' },
          collaborative: false,
          snapshot_id: '0',
        },
      })
      .catch(() => {});
  });
  await ready(page);
  const checkbox = page.getByRole('checkbox', { name: 'My playlist', exact: true });
  await checkbox.check();
  await expect.poll(() => started).toBe(true);
  await checkbox.uncheck();
  release();
  await expect(
    page.getByText('Select playlists to load their tracks', { exact: true }),
  ).toBeVisible();
  expect(mock.requests.some((r) => r.path === 'playlists/p/items')).toBe(false);
});

test('folder preferences persist but playlist selection starts empty on reload', async ({
  page,
}) => {
  await mockSpotify(page);
  await ready(page);
  await page.getByRole('button', { name: 'Create local folder', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Evening');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dropdown = page.getByRole('combobox', { name: 'Move My playlist to folder' });
  const folderId = await dropdown
    .locator('option')
    .filter({ hasText: 'Evening' })
    .getAttribute('value');
  await dropdown.selectOption(folderId!);
  await page.getByRole('button', { name: 'Toggle playlists in Evening', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('status').first()).toContainText('Playlist list ready');
  await expect(page.getByRole('textbox', { name: 'Rename folder' })).toHaveValue('Evening');
  await expect(page.getByRole('checkbox', { name: 'My playlist', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Toggle playlists in Evening', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Alpha', exact: true }).check();
  await page.getByRole('textbox', { name: 'Search library' }).fill('Beta');
  await expect(page.getByRole('button', { name: 'Create playlist', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Beta')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/b',
  );
});

test('stages edits without requests, saves hidden-playlist drafts together, and supports Undo', async ({
  page,
}) => {
  const mock = await mockSpotify(page);
  await ready(page);
  await select(page);
  await select(page, 'Playlist 1');
  const initial = mock.requests.length;
  const alpha = page.getByRole('checkbox', { name: 'Alpha in My playlist', exact: true });
  await alpha.uncheck();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Alpha in Playlist 1', exact: true }).check();
  const beta = page.getByRole('checkbox', { name: 'Beta in My playlist', exact: true });
  await beta.uncheck();
  await beta.check();
  expect(mock.requests).toHaveLength(initial);
  expect(writes(mock.requests)).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Remove Playlist 1 from playlist selection', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save changes (2)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toHaveCount(0);
  expect(writes(mock.requests)).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(alpha).toBeChecked();
  await expect(alpha).toBeEnabled();
  await alpha.uncheck();
  const beforeDiscard = mock.requests.length;
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(alpha).toBeChecked();
  expect(mock.requests).toHaveLength(beforeDiscard);
});

test('failed Save keeps drafts and protects Refresh and disconnect from silent discard', async ({
  page,
}) => {
  const mock = await mockSpotify(page);
  await ready(page);
  await select(page);
  await page.getByRole('checkbox', { name: 'Alpha in My playlist', exact: true }).uncheck();
  mock.failEdits();
  await page.getByRole('button', { name: 'Save changes (1)', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('denied');
  await expect(page.getByRole('button', { name: 'Save changes (1)', exact: true })).toBeEnabled();
  const before = mock.requests.length;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Unsaved playlist changes');
  expect(mock.requests).toHaveLength(before);
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Spotify', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  mock.allowEdits();
  await page.getByRole('button', { name: 'Save changes (1)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});

test('selected playlist scope combines with nested advanced filters and handles inaccessible sources', async ({
  page,
}) => {
  await mockSpotify(page);
  await ready(page);
  await select(page);
  await select(page, 'Playlist 1');
  await expect(page.locator('tbody tr[data-index]')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Followed playlist', exact: true }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Followed playlist', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: '+ Group', exact: true }).click();
  await page.getByLabel('Filter group logic').nth(1).selectOption('none');
  await page
    .locator('fieldset')
    .nth(1)
    .getByRole('button', { name: '+ Condition', exact: true })
    .click();
  await page.getByLabel('Filter value').fill('One');
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear advanced filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toBeVisible();
});

test('partial playlist creation resumes without duplicating confirmed batches', async ({
  page,
}) => {
  const mock = await mockSpotify(page, 205);
  mock.failCreationBatch();
  await ready(page);
  await select(page);
  await page.getByRole('checkbox', { name: 'Select all results', exact: true }).check();
  await page.getByRole('button', { name: 'Create playlist (205)', exact: true }).click();
  await page.getByRole('textbox', { name: 'Playlist name' }).fill('Recovery');
  await page.getByRole('button', { name: 'Create public playlist', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('100 of 205 items added');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Resume playlist creation', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Resume playlist creation', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Resume playlist creation', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('205 of 205 items added');
  expect(mock.created).toHaveLength(205);
  expect(new Set(mock.created).size).toBe(205);
});

test('virtualizes 20,000 selected rows with sticky headers and fixed preview', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await mockSpotify(page, 20000, 20);
  await ready(page);
  await page.getByRole('checkbox', { name: 'My playlist', exact: true }).check();
  await expect(
    page.getByRole('button', { name: 'Remove My playlist from playlist selection', exact: true }),
  ).toBeAttached({ timeout: 30000 });
  for (let i = 1; i < 20; i++)
    await page.getByRole('checkbox', { name: `Playlist ${i}`, exact: true }).check();
  await expect(page.getByText('20 playlist columns', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1000000);
  await page.evaluate(() => window.scrollTo(0, 800000));
  await expect
    .poll(async () =>
      Number(await page.locator('tbody tr[data-index]').first().getAttribute('data-index')),
    )
    .toBeGreaterThan(10000);
  expect(await page.locator('tbody tr[data-index]').count()).toBeLessThan(60);
  const header = page.getByLabel('Library column headers scroll area'),
    body = page.getByLabel('Library table scroll area');
  await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
  await header.evaluate((el) => {
    el.scrollLeft = 500;
  });
  await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBe(500);
  const h = await header.locator('th').nth(2).boundingBox(),
    cell = await page.locator('tbody tr[data-index]').first().locator('td').nth(2).boundingBox();
  expect(Math.abs(h!.x - cell!.x)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath('page-scroll.png') });
  await body.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('tbody tr[data-index="19999"]')).toBeVisible();
  await page.locator('tbody tr[data-index="19999"]').getByRole('button').click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.locator('tbody tr[data-index="19999"]').boundingBox(),
    preview = await page.locator('.preview-bar').boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(preview!.y);
});

test('creates an empty playlist without loading sources or adding items', async ({ page }) => {
  const mock = await mockSpotify(page);
  await ready(page);
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('An empty public playlist will be created');
  const submit = page.getByRole('button', { name: 'Create public playlist', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole('textbox', { name: 'Playlist name' }).fill('Empty collection');
  await submit.click();
  await expect(page.getByRole('dialog')).toContainText('Complete');
  expect(
    mock.requests.filter((r) => r.path === 'me/playlists' && r.method === 'POST'),
  ).toHaveLength(1);
  expect(mock.requests.some((r) => r.path === 'playlists/new/items')).toBe(false);
});

test('uses one dynamic embed for tracks and episodes without API lookups', async ({ page }) => {
  const mock = await mockSpotify(page);
  await page.route('https://api.spotify.com/v1/playlists/p/items*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            item: {
              uri: 'spotify:track:a',
              type: 'track',
              name: 'Alpha',
              artists: [],
              duration_ms: 1000,
            },
            added_at: null,
          },
          {
            item: {
              uri: 'spotify:episode:e',
              type: 'episode',
              name: 'Episode',
              show: { name: 'Show' },
              duration_ms: 1000,
            },
            added_at: null,
          },
        ],
        next: null,
      },
    }),
  );
  await ready(page);
  await select(page);
  const before = mock.requests.length;
  await expect(page.locator('.preview-bar iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Alpha')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/a',
  );
  await expect(page.locator('.preview-bar iframe')).toHaveAttribute('allow', /encrypted-media/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { embedCalls: string[][] }).embedCalls.filter(
            (c) => c[0] === 'play',
          ).length,
      ),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { embedCalls: string[][] }).embedCalls.filter(
            (c) => c[0] === 'play',
          ).length,
      ),
    )
    .toBe(2);
  await page.getByRole('button', { name: 'Episode', exact: true }).click();
  await expect(page.locator('.preview-bar iframe')).toHaveCount(1);
  await expect(page.getByTitle('Spotify player: Episode')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/episode/e',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { embedCalls: string[][] }).embedCalls.filter(
            (c) => c[0] === 'play',
          ).length,
      ),
    )
    .toBe(3);
  await page.getByRole('checkbox', { name: 'Alpha in My playlist', exact: true }).uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  const player = await page.locator('.preview-bar iframe').boundingBox();
  expect(player!.x).toBeGreaterThanOrEqual(0);
  expect(player!.x + player!.width).toBeLessThanOrEqual(390);
  const draft = await page.locator('.draft-bar').boundingBox();
  const bar = await page.locator('.preview-bar').boundingBox();
  expect(draft!.y + draft!.height).toBeLessThanOrEqual(bar!.y);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.locator('.preview-bar iframe')).toHaveCount(0);
  expect(mock.requests).toHaveLength(before);
  expect(
    await page.evaluate(() => (window as unknown as { embedCalls: string[][] }).embedCalls.at(-1)),
  ).toEqual(['destroy']);
});

test('plays only the latest selection when the embed becomes ready', async ({ page }) => {
  await page.addInitScript('window.embedReadyDelay = 800');
  await mockSpotify(page);
  await ready(page);
  await select(page);
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Beta')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/b',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { embedCalls: string[][] }).embedCalls.filter((c) => c[0] === 'play'),
      ),
    )
    .toEqual([['play']]);
});

test('keeps a usable embed when the iframe API script fails', async ({ page }) => {
  await page.route('https://open.spotify.com/embed/iframe-api/v1', (route) => route.abort());
  await mockSpotify(page);
  await ready(page);
  await select(page);
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Alpha')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/a',
  );
  await expect(page.getByRole('link', { name: 'Open in Spotify' })).toBeVisible();
});

test('shows and switches embeds even when the control script never calls back', async ({
  page,
}) => {
  await page.route('https://open.spotify.com/embed/iframe-api/v1', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: '/* bootstrap loaded, nested script stalled */',
    }),
  );
  const mock = await mockSpotify(page);
  await ready(page);
  await select(page);
  const before = mock.requests.length;
  await page.clock.install();
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Alpha')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/a',
  );
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Beta')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/b',
  );
  await page.clock.fastForward(11000);
  await expect(page.locator('.preview-bar iframe')).toHaveCount(1);
  await expect(page.getByTitle('Spotify player: Beta')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/b',
  );
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.locator('.preview-bar iframe')).toHaveCount(0);
  expect(mock.requests).toHaveLength(before);
});

test('restores a plain embed if controller creation removes the frame then throws', async ({
  page,
}) => {
  await page.route('https://open.spotify.com/embed/iframe-api/v1', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.onSpotifyIframeApiReady({ createController(mount) { mount.remove(); throw new Error('Controller failed'); } });`,
    }),
  );
  await mockSpotify(page);
  await ready(page);
  await select(page);
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Alpha')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/a',
  );
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  await expect(page.getByTitle('Spotify player: Beta')).toHaveAttribute(
    'src',
    'https://open.spotify.com/embed/track/b',
  );
});

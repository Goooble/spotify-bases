import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    env: {
      VITE_SPOTIFY_CLIENT_ID: 'test-client',
      VITE_SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:5174/callback',
    },
  },
  reporter: 'list',
});

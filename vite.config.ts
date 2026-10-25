import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    include: ['src/**/*.test.ts'],
    env: { VITE_SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:5173/callback' },
  },
});

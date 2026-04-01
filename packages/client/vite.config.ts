import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_API_URL can be set to point to a different backend (e.g. the E2E test server).
const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:3001';
const wsUrl = apiUrl.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiUrl,
      '/ws': { target: wsUrl, ws: true },
    },
  },
});

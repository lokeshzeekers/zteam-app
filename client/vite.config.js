import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build fingerprint. Every deployment gets a new id; it is baked into the JS bundle AND published
// as /version.json, so an app that is already open (Electron / Android WebView / browser tab) can
// notice that the server now has a newer build (see src/components/UpdateBanner.jsx).
const BUILD_ID = `${(process.env.GITHUB_SHA || '').slice(0, 7) || 'local'}-${Date.now().toString(36)}`;
const versionFile = () => ({
  name: 'zteam-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
});

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Absolute by default: the website uses client-side routes like /chat/6, and a relative base
  // ('./') makes a reload there request /chat/assets/... (served as HTML -> blank page).
  // Electron loads the live site, so it does not need relative paths; for a file:// build use
  //   npm run build:file
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
        // Without this, whenever the backend restarts (nodemon) or a tab
        // reloads mid-connection, http-proxy throws an uncaught
        // "write ECONNABORTED" and dumps a stack trace into the terminal.
        // The socket itself reconnects fine either way — this just stops
        // the noisy/scary-looking crash log for something harmless.
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[vite] socket.io proxy connection dropped (client will auto-reconnect):', err.message);
          });
        },
      },
    },
  },
});

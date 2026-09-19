import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // important so the built app also works loaded from file:// inside Electron
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

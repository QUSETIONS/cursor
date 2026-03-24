import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

// ★ CRITICAL: Cursor IDE terminal injects ELECTRON_RUN_AS_NODE=1, which causes
// electron.exe to run as a regular Node.js process instead of an Electron app.
// When that happens, require('electron') returns the binary path string instead
// of the API module. We MUST delete it HERE so the child electron.exe process
// inherits a clean environment.
delete process.env.ELECTRON_RUN_AS_NODE;

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'keytar', 'better-sqlite3', 'imap', 'undici', 'tesseract.js', 'puppeteer-core', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const projectDir = typeof import.meta.dirname !== 'undefined' ? import.meta.dirname : path.resolve('.');
const hasLocalFirebaseConfig = fs.existsSync(
  path.resolve(projectDir, 'firebase-applet-config.json')
);
const firebaseConfigTarget = hasLocalFirebaseConfig
  ? path.resolve(projectDir, 'firebase-applet-config.json')
  : path.resolve(projectDir, 'firebase-applet-config.example.json');

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        id: '/',
        name: 'Umbras Pass - MTG Deck Analyzer & Simulator',
        short_name: 'UmbrasPass',
        description: 'Magic: The Gathering deck analyzer, mana optimizer, and playtest simulator.',
        theme_color: '#090a0f',
        background_color: '#090a0f',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@/firebase-applet-config.json': firebaseConfigTarget,
      '@': path.resolve(projectDir, '.'),
    },
  },
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(rawId: string) {
          const id = rawId.replace(/\\/g, '/');
          if (!id.includes('/node_modules/')) return undefined;
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (
            id.includes('/node_modules/recharts') ||
            id.includes('/node_modules/d3-') ||
            id.includes('/node_modules/victory-vendor')
          ) {
            return 'charts-vendor';
          }
          if (id.includes('/node_modules/lucide-react')) {
            return 'icons-vendor';
          }
          if (id.includes('/node_modules/firebase') || id.includes('/node_modules/@firebase')) {
            return 'firebase-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});

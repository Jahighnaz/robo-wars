import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages /<repo>/).
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Scrap Evolution',
        short_name: 'Scrap Evo',
        description: 'Build a block machine, survive the waves, face worlds that evolve against you.',
        theme_color: '#05060b',
        background_color: '#05060b',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});

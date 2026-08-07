import { defineConfig } from 'vite';

export default defineConfig({
  // Project pages live at https://<user>.github.io/fireteam-report/, so every
  // asset URL has to be prefixed or the built site 404s on GitHub Pages.
  base: '/fireteam-report/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
});

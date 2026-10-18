import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error Local middleware is shared with Node tests as plain JavaScript.
import { cardEditorApi } from './scripts/card-editor-api.mjs';

export default defineConfig({
  plugins: [react(), {
    name: 'local-card-editor',
    configureServer(server) {
      server.middlewares.use(cardEditorApi(server.config.root));
    },
  }],
  // Relative URLs also work when hosted under /moonCards/ on GitHub Pages.
  base: './',
});

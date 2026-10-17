import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative URLs also work when hosted under /moonCards/ on GitHub Pages.
  base: './',
});

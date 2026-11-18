import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Mediabunny (reading and writing video) is most of the bundle: about 250 KB gzipped in total.
  build: { chunkSizeWarningLimit: 1200 },
});

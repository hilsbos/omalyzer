import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--target web` emits glue that fetches *_bg.wasm via new URL(..., import.meta.url).
// Vite handles that as a static asset automatically — no vite-plugin-wasm.
// Cross-origin isolation is NOT required: this build is single-threaded wasm
// (no SharedArrayBuffer / wasm threads), so no COOP/COEP headers needed.
// getUserMedia requires a secure context; localhost is treated as secure, so
// plain `vite` (http://localhost) is fine for dev — no https needed locally.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
  },
});

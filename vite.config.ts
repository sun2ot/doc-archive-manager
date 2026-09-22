import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/target/**'] } },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2022' },
});


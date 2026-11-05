import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error plain JS module shared with the production server
import { handleApi } from './server/api.mjs';

/** Mounts the local Schedrift API into the Vite dev server (one process in development). */
function schedriftApi(): Plugin {
  return {
    name: 'schedrift-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handleApi(req, res).then((handled: boolean) => (handled ? undefined : next()), next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), schedriftApi()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  build: { target: 'es2022', sourcemap: false },
});

import { defineConfig } from 'vite';
import { proxyMiddleware } from './server/proxy.js';

const relay = { name: 'vysielac-relay', configureServer: s => { s.middlewares.use(proxyMiddleware({ log: m => console.log(m) })); }, configurePreviewServer: s => { s.middlewares.use(proxyMiddleware()); } };

export default defineConfig({
  plugins: [relay],
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
});

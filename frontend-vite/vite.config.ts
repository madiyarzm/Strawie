import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the React app runs on :5173 and the FastAPI backend on :8000.
// Proxying /api, /health, and /ws through Vite makes the browser see
// everything as same-origin, which is what httpOnly cookies need to work
// without CORS gymnastics (the production deployment is naturally
// same-origin since FastAPI serves the built frontend).
// Cross-origin isolation, matching the production headers set by FastAPI
// (app/core/security_middleware.py). The in-browser Python worker needs it
// for SharedArrayBuffer: typed input() and instant Stop.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// The Python worker runs other people's code, so it gets a policy that can
// reach only the Pyodide CDN, never our API. Same value as WORKER_CSP in
// app/core/security_middleware.py (which sets it in production).
const workerCsp = [
  "default-src 'none'",
  "script-src blob: https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
  "connect-src https://cdn.jsdelivr.net",
  "worker-src 'none'",
].join("; ")

function workerPolicy(): Plugin {
  const apply = (server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] === "/py-worker.js") res.setHeader("Content-Security-Policy", workerCsp)
      next()
    })
  }
  return { name: "strawie-worker-csp", configureServer: apply, configurePreviewServer: apply }
}

export default defineConfig({
  plugins: [react(), workerPolicy()],
  preview: { headers: isolationHeaders },
  server: {
    headers: isolationHeaders,
    proxy: {
      '/api': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
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

export default defineConfig({
  plugins: [react()],
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

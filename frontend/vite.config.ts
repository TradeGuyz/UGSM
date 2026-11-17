import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // No VITE_ prefix, so this stays in the config and never reaches the browser
  const env = loadEnv(mode, process.cwd(), '')
  // The API in ../backend, run with `npm run dev` there or with Docker.
  // For the live API, use the deployed site's address (see .env.example).
  const target = (env.API_URL || 'http://localhost:3001').replace(/\/+$/, '')
  const remote = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(target)

  // Proxied, so the browser sees one origin and the SameSite=Strict session cookie keeps working.
  // A remote site needs its own Host header to route the request; the local backend wants the
  // X-Forwarded-* headers instead, for the client IP behind the PIN lockout.
  const proxy: Record<string, ProxyOptions> = {
    '/api': remote ? { target, changeOrigin: true, secure: true } : { target, xfwd: true },
  }

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // No VITE_ prefix, so this stays in the config and never reaches the browser
  const env = loadEnv(mode, process.cwd(), '')
  // The API in ../backend, run with `npm run dev` there or with Docker
  const target = env.API_URL || 'http://localhost:3001'

  // Proxied, so the browser sees one origin and the SameSite=Strict session cookie keeps working
  const proxy = { '/api': { target, xfwd: true } }

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})

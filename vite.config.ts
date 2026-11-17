import { readdir } from 'node:fs/promises'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const RANKUOG_API = 'https://nccumhlfkzdvitvrzvjv.supabase.co/functions/v1/collection-api'

// Lists the SVG frame designs in public/ so the photo booth page picks up new ones automatically
function photoFrames(): Plugin {
  return {
    name: 'photo-frames',
    configureServer(server) {
      server.middlewares.use('/api/frames', async (_req, res) => {
        const files = await readdir(server.config.publicDir)
        const frames = files.filter((f) => f.toLowerCase().endsWith('.svg')).sort()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(frames))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // No VITE_ prefix, so the key stays on the dev server and never reaches the browser
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), photoFrames()],
    server: {
      proxy: {
        '/api/rankuog': {
          target: RANKUOG_API,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/rankuog/, ''),
          headers: { Authorization: `Bearer ${env.RANKUOG_API_KEY ?? ''}` },
        },
      },
    },
  }
})

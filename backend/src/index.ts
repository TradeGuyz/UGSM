import './env.ts'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createAdminApi } from './admin.ts'
import { lookupCollection } from './rankuog.ts'
import { createStore } from './store.ts'

const env = process.env
const port = Number(env.PORT) || 3001
const host = env.HOST || '0.0.0.0'
// Defaults to smc/data, outside both app folders, so neither git nor a static file server can reach it
const file = env.SETTINGS_FILE || fileURLToPath(new URL('../../data/settings.json', import.meta.url))
const store = createStore(file, env.APP_PIN)

if (store.pinSource() === 'none') console.warn('No PIN is set: add APP_PIN to backend/.env so you can unlock the app')
else if (store.pinSource() === 'env' && env.APP_PIN!.length < 6) {
  console.warn('APP_PIN is shorter than 6 characters; change it in Settings before going online')
}

// First run: bring over a key given in the environment
const importKey = env.RANKUOG_API_KEY
if (store.isNew && importKey) {
  lookupCollection(importKey).then((result) => {
    if (!result.ok) return console.warn(`Couldn't import RANKUOG_API_KEY: ${result.message}`)
    if (store.findByCollectionId(result.collectionId)) return
    const { collectionId, title, url } = result
    store.addCollection({ key: importKey, label: title, collectionId, title, url })
    console.info(`Imported the RankUOG key for “${title}” into Settings`)
  })
}

const sessionSecret = env.SESSION_SECRET
const proxySecret = env.API_SIGNATURE_TOKEN
// Cloud Run sets K_SERVICE; there these are needed, locally they're optional
if (env.K_SERVICE) {
  if (!sessionSecret) console.warn('SESSION_SECRET is not set: every restart will sign everyone out')
  if (!proxySecret) console.warn('API_SIGNATURE_TOKEN is not set: the API accepts requests that skip Netlify')
}
if (sessionSecret && sessionSecret.length < 32) console.warn('SESSION_SECRET should be at least 32 characters')

const api = createAdminApi(store, { sessionSecret, proxySecret })

const server = createServer((req, res) => {
  api(req, res, (err) => {
    if (err) {
      console.error(err)
      if (res.headersSent) return res.destroy()
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Something went wrong on the server' }))
    }
    // This server only answers /api; the frontend is served separately
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })
})

server.listen(port, host, () => console.info(`API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`))

// Docker sends SIGTERM on stop; finish in-flight requests rather than cutting them off
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}

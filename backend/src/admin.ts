import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { TLSSocket } from 'node:tls'
import { lookupCollection, RANKUOG_API } from './rankuog.ts'
import type { Collection, Store } from './store.ts'

// Connect-style middleware: index.ts runs it on a plain node:http server, but it also fits Express
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

const COOKIE = 'smc_session'
const SESSION_MS = 12 * 60 * 60 * 1000
const MAX_FAILURES = 5
const LOCKOUT_MS = 15 * 60 * 1000
const MAX_JSON_BYTES = 4096
const PIN_PATTERN = /^\d{6,12}$/
// Passed back from RankUOG, so the browser knows how long to wait when told to slow down
const FORWARDED_HEADERS = ['retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

function isHttps(req: IncomingMessage): boolean {
  return Boolean((req.socket as TLSSocket).encrypted) || req.headers['x-forwarded-proto'] === 'https'
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Netlify's signed proxy (`signed = "API_SIGNATURE_TOKEN"` in netlify.toml) adds X-Nf-Sign, an HS256 JWT
 * made with that token. A valid one proves the request came through the Netlify site.
 * Returns why a request was turned away, or null when the signature is good.
 */
function netlifySignatureProblem(token: string | undefined, secret: string): string | null {
  if (!token) return 'no X-Nf-Sign header (is API_SIGNATURE_TOKEN set in Netlify, and was the site redeployed after?)'
  const [head, payload, signature] = token.split('.')
  if (!head || !payload || !signature) return 'X-Nf-Sign is not a JWT'
  let alg: unknown
  let claims: { exp?: unknown; iss?: unknown; [key: string]: unknown }
  try {
    alg = (JSON.parse(Buffer.from(head, 'base64url').toString()) as { alg?: unknown }).alg
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as typeof claims
  } catch {
    return 'X-Nf-Sign is not a JWT'
  }
  if (alg !== 'HS256') return `X-Nf-Sign uses ${String(alg)}, expected HS256`
  const expected = Buffer.from(createHmac('sha256', secret).update(`${head}.${payload}`).digest('base64url'))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return 'X-Nf-Sign signature does not match: API_SIGNATURE_TOKEN differs between Netlify and Cloud Run'
  }
  if (claims.iss !== undefined && claims.iss !== 'netlify') return `X-Nf-Sign issuer is ${String(claims.iss)}`
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return 'X-Nf-Sign has expired'
  return null
}

export type AdminOptions = {
  /** Signs session cookies, so sessions survive restarts. Without it, a random key is made at startup. */
  sessionSecret?: string
  /** Netlify's proxy signing token. When set, every /api request except /api/health must be signed with it. */
  proxySecret?: string
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_JSON_BYTES) {
        reject(new HttpError(413, 'Request too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Not an object')
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new HttpError(400, 'Send a JSON object'))
      }
    })
    req.on('error', reject)
  })
}

// Only enough of the key to tell keys apart; the full key never leaves the server
function keyHint(key: string): string {
  return key.length > 16 ? `${key.slice(0, 9)}…${key.slice(-4)}` : '••••'
}

function publicCollection(c: Collection) {
  return { id: c.id, label: c.label, title: c.title, url: c.url, keyHint: keyHint(c.key), addedAt: c.addedAt }
}

/**
 * Everything under /api:
 *   GET    /api/health                                 200 while the server is up (for Docker)
 *   POST   /api/unlock  { pin }                        sets an HttpOnly session cookie
 *   POST   /api/lock                                   clears it
 *   GET    /api/session                                200 when unlocked, 401 otherwise
 * and, only with a session:
 *   GET    /api/settings                               PIN source and saved collections (keys masked)
 *   POST   /api/settings/pin  { currentPin, newPin }   changes the PIN and signs out every other session
 *   POST   /api/settings/collections  { key, label? }  checks the key with RankUOG, then saves it
 *   DELETE /api/settings/collections/<id>
 *   *      /api/rankuog/<id>/<path>                    forwarded to RankUOG with that collection's key
 * Any other /api/* request without a session gets 401 and never reaches the routes behind it.
 */
export function createAdminApi(store: Store, options: AdminOptions = {}): Middleware {
  const { sessionSecret, proxySecret } = options
  // Used when there's no SESSION_SECRET. Replaced when the PIN changes, which signs everyone out.
  let randomSecret = randomBytes(32)
  const failures = new Map<string, { count: number; lockedUntil: number }>()

  // With SESSION_SECRET, the key is derived from it and the current PIN,
  // so sessions survive restarts but changing the PIN still signs everyone out
  function secret(): Buffer {
    if (!sessionSecret) return randomSecret
    return createHmac('sha256', sessionSecret).update(store.pinStamp()).digest()
  }

  function sign(expires: number): string {
    return createHmac('sha256', secret()).update(String(expires)).digest('base64url')
  }

  // The socket address is the proxy's, not the browser's, so the browser's address comes from a header.
  // Behind Netlify (proxySecret set, so the request is already known to be signed) that's Netlify's
  // X-Nf-Client-Connection-Ip. In local dev, X-Forwarded-For from the Vite proxy on this machine
  // (or from any peer with TRUST_PROXY=1), using only the last entry: the one the proxy added.
  function clientIp(req: IncomingMessage): string {
    const peer = req.socket.remoteAddress ?? 'unknown'
    if (proxySecret) return header(req, 'x-nf-client-connection-ip') ?? peer
    const forwarded = header(req, 'x-forwarded-for')
    if (!forwarded || !(LOOPBACK.has(peer) || process.env.TRUST_PROXY === '1')) return peer
    return forwarded.split(',').pop()?.trim() || peer
  }

  function hasSession(req: IncomingMessage): boolean {
    const token = readCookie(req, COOKIE)
    if (!token) return false
    const [expires, signature] = token.split('.')
    if (!expires || !signature || Number(expires) < Date.now()) return false
    const expected = Buffer.from(sign(Number(expires)))
    const given = Buffer.from(signature)
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  function sessionCookie(req: IncomingMessage, value: string, maxAgeSeconds: number): string {
    const secure = isHttps(req) ? '; Secure' : ''
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`
  }

  function newSessionCookie(req: IncomingMessage): string {
    const expires = Date.now() + SESSION_MS
    return sessionCookie(req, `${expires}.${sign(expires)}`, SESSION_MS / 1000)
  }

  // Shared by unlocking and changing the PIN, so both count towards the same lockout
  function checkPin(req: IncomingMessage, pin: unknown) {
    if (store.pinSource() === 'none') throw new HttpError(503, 'The PIN has not been set up on the server')

    const ip = clientIp(req)
    const record = failures.get(ip)
    if (record && record.lockedUntil > Date.now()) {
      const retryAfter = Math.ceil((record.lockedUntil - Date.now()) / 1000)
      return { ok: false as const, status: 429, body: { error: 'Too many wrong attempts', retryAfter } }
    }

    if (typeof pin === 'string' && store.verifyPin(pin)) {
      failures.delete(ip)
      return { ok: true as const }
    }

    // A record still locked was turned away above, so a non-zero lockedUntil here has expired: start over
    const count = (record && record.lockedUntil === 0 ? record.count : 0) + 1
    failures.set(ip, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0 })
    if (count >= MAX_FAILURES) console.warn(`Locked out ${ip} for ${LOCKOUT_MS / 60000} minutes after ${count} wrong PINs`)
    return { ok: false as const, status: 401, body: { error: 'Wrong PIN', attemptsLeft: Math.max(0, MAX_FAILURES - count) } }
  }

  function settingsBody() {
    return { pinSource: store.pinSource(), collections: store.listCollections().map(publicCollection) }
  }

  async function unlock(req: IncomingMessage, res: ServerResponse) {
    const { pin } = await readJson(req)
    const result = checkPin(req, pin)
    if (!result.ok) return json(res, result.status, result.body)
    json(res, 200, { unlocked: true }, { 'Set-Cookie': newSessionCookie(req) })
  }

  async function changePin(req: IncomingMessage, res: ServerResponse) {
    const { currentPin, newPin } = await readJson(req)
    if (typeof newPin !== 'string' || !PIN_PATTERN.test(newPin)) {
      throw new HttpError(400, 'The new PIN must be 6 to 12 digits')
    }
    const result = checkPin(req, currentPin)
    if (!result.ok) {
      const error = result.status === 401 ? 'Your current PIN is wrong' : result.body.error
      return json(res, result.status, { ...result.body, error })
    }
    store.setPin(newPin)
    randomSecret = randomBytes(32)
    json(res, 200, settingsBody(), { 'Set-Cookie': newSessionCookie(req) })
  }

  async function addCollection(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : ''
    if (!key || /\s/.test(key) || key.length > 200) throw new HttpError(400, 'Paste the API key from RankUOG')

    const result = await lookupCollection(key)
    if (!result.ok) throw new HttpError(400, result.message)

    const existing = store.findByCollectionId(result.collectionId)
    if (existing) throw new HttpError(409, `“${existing.title}” is already saved. Remove it first to replace its key.`)

    store.addCollection({ key, label: label || result.title, collectionId: result.collectionId, title: result.title, url: result.url })
    json(res, 201, settingsBody())
  }

  async function proxy(req: IncomingMessage, res: ServerResponse, id: string, rest: string, query: string) {
    const collection = store.getCollection(id)
    if (!collection) throw new HttpError(404, 'No saved collection with that id')

    const headers: Record<string, string> = { Authorization: `Bearer ${collection.key}` }
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    // duplex is required to stream a request body through fetch, but isn't in the RequestInit types yet
    const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers }
    if (hasBody) {
      init.body = Readable.toWeb(req) as unknown as RequestInit['body']
      init.duplex = 'half'
    }

    let upstream: Response
    try {
      upstream = await fetch(`${RANKUOG_API}${rest}${query}`, init)
    } catch {
      throw new HttpError(502, "Couldn't reach RankUOG")
    }
    // Our own 401 means "session ended", so a key RankUOG turns down is reported differently.
    // 424 rather than a 5xx, so the browser doesn't keep retrying a key that won't work.
    if (upstream.status === 401 || upstream.status === 403) {
      await upstream.body?.cancel()
      throw new HttpError(424, "RankUOG rejected this collection's key. Check it in Settings.")
    }
    const responseHeaders: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    }
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders[name] = value
    }
    res.writeHead(upstream.status, responseHeaders)
    if (upstream.body) Readable.fromWeb(upstream.body as NodeReadableStream).pipe(res)
    else res.end()
  }

  async function route(req: IncomingMessage, res: ServerResponse, path: string, query: string): Promise<boolean> {
    const method = req.method ?? 'GET'

    if (path === '/api/health') {
      json(res, 200, { ok: true })
      return true
    }
    if (path === '/api/unlock' && method === 'POST') return unlock(req, res).then(() => true)
    if (path === '/api/lock' && method === 'POST') {
      json(res, 200, { unlocked: false }, { 'Set-Cookie': sessionCookie(req, '', 0) })
      return true
    }
    if (path === '/api/session') {
      if (hasSession(req)) json(res, 200, { unlocked: true })
      else json(res, 401, { unlocked: false })
      return true
    }

    if (!hasSession(req)) {
      json(res, 401, { error: 'Locked' })
      return true
    }

    if (path === '/api/settings' && method === 'GET') {
      json(res, 200, settingsBody())
      return true
    }
    if (path === '/api/settings/pin' && method === 'POST') return changePin(req, res).then(() => true)
    if (path === '/api/settings/collections' && method === 'POST') return addCollection(req, res).then(() => true)

    const remove = /^\/api\/settings\/collections\/([^/]+)$/.exec(path)
    if (remove && method === 'DELETE') {
      if (!store.removeCollection(remove[1])) throw new HttpError(404, 'No saved collection with that id')
      json(res, 200, settingsBody())
      return true
    }

    const forward = /^\/api\/rankuog\/([^/]+)(\/.*)?$/.exec(path)
    if (forward) return proxy(req, res, forward[1], forward[2] ?? '', query).then(() => true)

    return false
  }

  return (req, res, next) => {
    const [path, search] = (req.url ?? '').split('?')
    if (!path.startsWith('/api/')) return next()

    // Behind Netlify, turn away anything that didn't come through the site, e.g. calls straight to
    // the Cloud Run URL. Otherwise those could fake the client-IP header and dodge the PIN lockout.
    if (proxySecret && path !== '/api/health') {
      const problem = netlifySignatureProblem(header(req, 'x-nf-sign'), proxySecret)
      if (problem) {
        console.warn(`Refused ${req.method} ${path}: ${problem}`)
        return json(res, 403, { error: 'Use the website to reach this API' })
      }
    }

    route(req, res, path, search ? `?${search}` : '')
      .then((handled) => {
        // Unknown API routes get a JSON 404 rather than falling through to the page's HTML
        if (!handled) json(res, 404, { error: 'Not found' })
      })
      .catch((err: unknown) => {
        if (res.headersSent) return res.destroy()
        if (err instanceof HttpError) return json(res, err.status, { error: err.message })
        next(err)
      })
  }
}

import { useEffect, useState, type FormEvent } from 'react'
import { LuExternalLink, LuKeyRound, LuPlus, LuTrash2 } from 'react-icons/lu'
import './Settings.css'

type Collection = { id: string; label: string; title: string; url: string; keyHint: string; addedAt: string }
type SettingsData = { pinSource: 'settings' | 'env' | 'none'; collections: Collection[] }
type Message = { kind: 'error' | 'success'; text: string } | null

type Props = {
  /** Called when the server says the session has ended, e.g. after the PIN changed elsewhere */
  onSessionExpired: () => void
}

class ApiError extends Error {}

async function api(path: string, init: RequestInit, onSessionExpired: () => void): Promise<SettingsData> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.")
  }
  const body = (await res.json().catch(() => ({}))) as Partial<SettingsData> & { error?: string; retryAfter?: number }
  if (res.ok) return body as SettingsData
  if (res.status === 401 && body.error === 'Locked') {
    onSessionExpired()
    throw new ApiError('Your session ended. Unlock again to continue.')
  }
  if (res.status === 429) {
    const minutes = Math.max(1, Math.ceil((body.retryAfter ?? 60) / 60))
    throw new ApiError(`Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }
  throw new ApiError(body.error ?? 'Something went wrong. Try again.')
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}

function Settings({ onSessionExpired }: Props) {
  const [data, setData] = useState<SettingsData | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    api('/api/settings', {}, onSessionExpired)
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setLoadError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [onSessionExpired])

  if (loadError) return <p className="settings-message error">{loadError}</p>
  if (!data) return <p className="settings-loading">Loading settings…</p>

  return (
    <div className="settings">
      <h1>Settings</h1>
      <PinSection pinSource={data.pinSource} onSaved={setData} onSessionExpired={onSessionExpired} />
      <CollectionsSection collections={data.collections} onChanged={setData} onSessionExpired={onSessionExpired} />
    </div>
  )
}

type PinSectionProps = {
  pinSource: SettingsData['pinSource']
  onSaved: (data: SettingsData) => void
  onSessionExpired: () => void
}

function PinSection({ pinSource, onSaved, onSessionExpired }: PinSectionProps) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6,12}$/.test(newPin)) return setMessage({ kind: 'error', text: 'The new PIN must be 6 to 12 digits.' })
    if (newPin !== confirmPin) return setMessage({ kind: 'error', text: "The new PINs don't match." })

    setBusy(true)
    setMessage(null)
    try {
      onSaved(await api('/api/settings/pin', { method: 'POST', body: JSON.stringify({ currentPin, newPin }) }, onSessionExpired))
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setMessage({ kind: 'success', text: 'PIN changed. Everyone else has been signed out.' })
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-card" aria-labelledby="pin-title">
      <h2 id="pin-title">PIN</h2>
      <p className="settings-hint">
        {pinSource === 'env'
          ? 'The PIN currently comes from APP_PIN in .env.local. Once you change it here, that value is no longer used.'
          : 'Changing the PIN signs out everyone except you.'}
      </p>
      <form className="settings-form" onSubmit={handleSubmit}>
        <label>
          Current PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        <label>
          New PIN <span className="settings-optional">6 to 12 digits</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        <label>
          Confirm new PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        <div className="settings-actions">
          <button type="submit" className="settings-button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Change PIN'}
          </button>
        </div>
        {message && (
          <p className={`settings-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </form>
    </section>
  )
}

type CollectionsSectionProps = {
  collections: Collection[]
  onChanged: (data: SettingsData) => void
  onSessionExpired: () => void
}

function CollectionsSection({ collections, onChanged, onSessionExpired }: CollectionsSectionProps) {
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [message, setMessage] = useState<Message>(null)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      onChanged(await api('/api/settings/collections', { method: 'POST', body: JSON.stringify({ label, key }) }, onSessionExpired))
      setLabel('')
      setKey('')
      setMessage({ kind: 'success', text: 'Key saved.' })
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(collection: Collection) {
    if (!window.confirm(`Remove the key for “${collection.label}”? Uploads to this collection will stop working.`)) return
    setRemoving(collection.id)
    setMessage(null)
    try {
      onChanged(await api(`/api/settings/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' }, onSessionExpired))
      setMessage({ kind: 'success', text: `Removed “${collection.label}”.` })
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) })
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="settings-card" aria-labelledby="keys-title">
      <h2 id="keys-title">Collection keys</h2>
      <p className="settings-hint">
        Each RankUOG API key gives access to one collection. Keys stay on the server; only the start and end are shown here.
      </p>

      {collections.length === 0 ? (
        <p className="settings-empty">No collection keys yet. Add one below.</p>
      ) : (
        <ul className="collection-list">
          {collections.map((c) => (
            <li key={c.id}>
              <LuKeyRound className="collection-icon" aria-hidden="true" />
              <div className="collection-info">
                <span className="collection-name">{c.label}</span>
                <span className="collection-meta">
                  {c.label !== c.title && <>{c.title} · </>}
                  <code>{c.keyHint}</code> · Added {new Date(c.addedAt).toLocaleDateString()}
                </span>
              </div>
              {c.url && (
                <a className="settings-button icon" href={c.url} target="_blank" rel="noreferrer" title="Open on RankUOG">
                  <LuExternalLink aria-hidden="true" />
                  <span className="visually-hidden">Open {c.label} on RankUOG (opens in a new tab)</span>
                </a>
              )}
              <button
                type="button"
                className="settings-button icon danger"
                onClick={() => handleRemove(c)}
                disabled={removing === c.id}
                title="Remove key"
              >
                <LuTrash2 aria-hidden="true" />
                <span className="visually-hidden">Remove the key for {c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="settings-form" onSubmit={handleAdd}>
        <h3>Add a key</h3>
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="rku_live_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        <label>
          Label <span className="settings-optional">optional, defaults to the collection's name</span>
          <input type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
        </label>
        <div className="settings-actions">
          <button type="submit" className="settings-button primary" disabled={busy || !key.trim()}>
            <LuPlus aria-hidden="true" /> {busy ? 'Checking with RankUOG…' : 'Add key'}
          </button>
        </div>
        {message && (
          <p className={`settings-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </form>
    </section>
  )
}

export default Settings

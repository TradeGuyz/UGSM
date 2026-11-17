import { useState, type FormEvent } from 'react'
import { LuLock } from 'react-icons/lu'
import './PinScreen.css'

type Props = {
  onUnlock: (pin: string) => Promise<{ ok: true } | { ok: false; message: string }>
}

function PinScreen({ onUnlock }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    setError('')
    const result = await onUnlock(pin)
    if (!result.ok) {
      setError(result.message)
      setPin('')
      setBusy(false)
    }
  }

  return (
    <form className="pin-screen" onSubmit={handleSubmit}>
      <LuLock className="pin-lock-icon" aria-hidden="true" />
      <label htmlFor="pin">Enter the PIN to continue</label>
      <input
        id="pin"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'pin-error' : undefined}
        disabled={busy}
      />
      <button type="submit" disabled={!pin || busy}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      <p id="pin-error" className="pin-error" role="alert">
        {error}
      </p>
    </form>
  )
}

export default PinScreen

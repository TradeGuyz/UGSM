import { useCallback, useEffect, useState } from 'react'

export type SessionStatus = 'checking' | 'locked' | 'unlocked'

type UnlockResult = { ok: true } | { ok: false; message: string }

// The server holds the PIN and the session cookie (HttpOnly), so this only asks it what state we're in
export function usePinSession() {
  const [status, setStatus] = useState<SessionStatus>('checking')

  useEffect(() => {
    let cancelled = false
    fetch('/api/session', { credentials: 'same-origin' })
      .then((res) => !cancelled && setStatus(res.ok ? 'unlocked' : 'locked'))
      .catch(() => !cancelled && setStatus('locked'))
    return () => {
      cancelled = true
    }
  }, [])

  const unlock = useCallback(async (pin: string): Promise<UnlockResult> => {
    let res: Response
    try {
      res = await fetch('/api/unlock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
    } catch {
      return { ok: false, message: "Couldn't reach the server. Check your connection and try again." }
    }

    if (res.ok) {
      setStatus('unlocked')
      return { ok: true }
    }

    const body = (await res.json().catch(() => ({}))) as { attemptsLeft?: number; retryAfter?: number; error?: string }
    if (res.status === 429) {
      const minutes = Math.max(1, Math.ceil((body.retryAfter ?? 60) / 60))
      return { ok: false, message: `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }
    }
    if (res.status === 401) {
      const left = body.attemptsLeft
      return {
        ok: false,
        message: left === undefined ? 'Wrong PIN.' : `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} left.`,
      }
    }
    return { ok: false, message: body.error ?? 'Something went wrong. Try again.' }
  }, [])

  const lock = useCallback(async () => {
    await fetch('/api/lock', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    setStatus('locked')
  }, [])

  return { status, unlock, lock }
}

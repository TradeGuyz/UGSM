import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { LuCheck, LuPrinter, LuRefreshCw, LuRotateCcw, LuScissors, LuX } from 'react-icons/lu'
import { Select } from '../Select.tsx'
import { PrintMarginField, Section, Switch } from '../booth/controls.tsx'
import { CARD_LAYOUT, SHEET_H, SHEET_W } from '../booth/layouts.ts'
import { QrCard } from '../booth/pieces.tsx'
import { loadPrintMargin, loadUsed, marginScale, place, printedSize, PX_PER_INCH, readStorage, savePrintMargin, writeStorage } from '../booth/storage.ts'
import { isThemeId, THEME_IDS, THEMES, type ThemeId } from '../booth/themes.ts'
import { fetchCollectionPhotos, SessionEndedError, useCollections, type CollectionPhoto } from '../rankuogClient.ts'
import '../booth/booth.css'
import './qr.css'

// How long to wait for the QR codes to load before giving up on printing
const QR_TIMEOUT_MS = 15_000
// Remembers which sets already had a QR card printed, so they can be told apart in the list
const PRINTED_KEY = 'qr-printed'
const MAX_PRINTED = 1000
const THUMBS_SHOWN = 4

/** Photos uploaded together (one Booth session), or a single photo uploaded on its own */
type PhotoSet = {
  key: string
  /** Empty when the photos had no caption; the collection's name stands in */
  title: string
  created: string
  photos: CollectionPhoto[]
}

// The Booth names a strip "<title> YYYY-MM-DD HH:MM:SS"; the title alone is the caption
const STRIP_STAMP = / \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function groupPhotos(photos: CollectionPhoto[]): PhotoSet[] {
  const sets = new Map<string, CollectionPhoto[]>()
  for (const photo of photos) {
    const key = photo.strip ? `strip:${photo.strip}` : `photo:${photo.id}`
    const list = sets.get(key)
    if (list) list.push(photo)
    else sets.set(key, [photo])
  }
  return [...sets.entries()]
    .map(([key, list]) => {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at))
      const first = list[0]
      const title = first.caption?.trim() || first.strip?.replace(STRIP_STAMP, '').trim() || ''
      return { key, title, created: first.created_at, photos: list }
    })
    .sort((a, b) => b.created.localeCompare(a.created))
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function loadPrinted(): Set<string> {
  try {
    const saved: unknown = JSON.parse(readStorage(PRINTED_KEY) ?? '[]')
    if (Array.isArray(saved)) return new Set(saved.filter((s): s is string => typeof s === 'string'))
  } catch {
    // Invalid saved value; nothing counts as printed
  }
  return new Set()
}

/**
 * True once every QR code on the sheet has loaded. A QR code that fails, or takes longer than
 * QR_TIMEOUT_MS, counts as not loaded, so a sheet never prints with a blank where a code should be.
 */
async function qrCodesLoaded(container: HTMLElement | null): Promise<boolean> {
  const images = [...(container?.querySelectorAll<HTMLImageElement>('.qr img') ?? [])]
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), QR_TIMEOUT_MS))
  const results = await Promise.all(
    images.map((img) =>
      Promise.race([
        img.decode().then(
          () => img.naturalWidth > 0,
          () => false,
        ),
        timeout,
      ]),
    ),
  )
  return results.every(Boolean)
}

type Props = {
  /** Called when the server says the session has ended */
  onSessionExpired: () => void
}

function QrPage({ onSessionExpired }: Props) {
  const collections = useCollections()
  const [chosenCollection, setChosenCollection] = useState(() => readStorage('qr-collection') ?? readStorage('booth-collection') ?? '')
  // The saved choice if it still exists, otherwise the first collection
  const collection = collections?.find((c) => c.id === chosenCollection) ?? collections?.[0]
  const collectionId = collection?.id ?? ''
  const [photos, setPhotos] = useState<{ collectionId: string; list: CollectionPhoto[] } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [filter, setFilter] = useState('')
  // Sets chosen for this sheet, in the order they were picked
  const [queue, setQueue] = useState<string[]>([])
  const [printed, setPrinted] = useState(loadPrinted)
  const [usedSlots, setUsedSlots] = useState(() => loadUsed(CARD_LAYOUT))
  const [margin, setMargin] = useState(loadPrintMargin)
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = readStorage('qr-theme') ?? readStorage('booth-theme')
    return isThemeId(saved) ? saved : 'classic'
  })
  const [decor, setDecor] = useState(() => readStorage('qr-decor') !== 'off')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [scale, setScale] = useState(1)
  const [qrAttempt, setQrAttempt] = useState(0)
  // Set when the last print stopped because a QR code didn't load
  const failedQr = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (collectionId) writeStorage('qr-collection', collectionId)
  }, [collectionId])
  useEffect(() => writeStorage('qr-theme', theme), [theme])
  useEffect(() => writeStorage('qr-decor', decor ? 'on' : 'off'), [decor])

  // Load the chosen collection's photos (again when Refresh is pressed)
  useEffect(() => {
    if (!collectionId) return
    const controller = new AbortController()
    fetchCollectionPhotos(collectionId, controller.signal).then(
      (list) => {
        setPhotos({ collectionId, list })
        setLoadError('')
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof SessionEndedError) onSessionExpired()
        else setLoadError(err instanceof Error ? err.message : "Couldn't load the photos.")
      },
    )
    return () => controller.abort()
  }, [collectionId, reload, onSessionExpired])

  // Shrink the Letter-size preview to fit its column (printing always uses the real size)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / (SHEET_W * PX_PER_INCH)))
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  // Photos from an earlier collection stay hidden until the new one has loaded
  const current = photos?.collectionId === collectionId ? photos.list : null
  const sets = useMemo(() => (current ? groupPhotos(current) : []), [current])
  const loading = Boolean(collectionId) && current === null && !loadError
  const fallbackTitle = collection?.label ?? 'Photos'
  const printedKey = (set: PhotoSet) => `${collectionId}|${set.key}`

  const query = filter.trim().toLowerCase()
  const shown = query
    ? sets.filter((s) => `${s.title} ${formatDate(s.created)} ${formatTime(s.created)}`.toLowerCase().includes(query))
    : sets

  // Free card spaces in the order they fill (bottom row first), and the chosen sets placed in them
  const freeSlots = CARD_LAYOUT.groups.flat().filter((s) => !usedSlots.has(s))
  const chosen = queue.flatMap((key) => sets.filter((s) => s.key === key))
  const placed = new Map(chosen.slice(0, freeSlots.length).map((set, i) => [freeSlots[i], set]))
  const overflow = chosen.length - placed.size
  const themeHasDecor = Object.keys(THEMES[theme].backDecor).length > 0
  const showDecor = decor && themeHasDecor

  function changeCollection(id: string) {
    setChosenCollection(id)
    setQueue([])
    setLoadError('')
    setNotice('')
  }

  function toggle(set: PhotoSet) {
    setNotice('')
    if (queue.includes(set.key)) {
      setQueue(queue.filter((k) => k !== set.key))
    } else if (queue.length >= freeSlots.length) {
      setNotice(freeSlots.length ? 'The sheet is full. Print it, or take a card off first.' : 'This sheet is used up. Load a fresh sheet, then press New sheet.')
    } else {
      setQueue([...queue, set.key])
    }
  }

  function changeMargin(next: number) {
    setMargin(next)
    savePrintMargin(next)
  }

  function saveUsed(next: Set<number>) {
    writeStorage(CARD_LAYOUT.storageKey, JSON.stringify([...next]))
    setUsedSlots(next)
  }

  function toggleSlot(slot: number) {
    const next = new Set(usedSlots)
    if (next.has(slot)) next.delete(slot)
    else next.add(slot)
    saveUsed(next)
  }

  // The printed cards are cut out: their spaces are used up and the sets leave the queue
  function markCut() {
    saveUsed(new Set([...usedSlots, ...placed.keys()]))
    const done = new Set([...placed.values()].map((s) => s.key))
    setQueue(queue.filter((k) => !done.has(k)))
    setNotice('')
  }

  function rememberPrinted(done: PhotoSet[]) {
    const next = new Set([...printed, ...done.map(printedKey)])
    const list = [...next].slice(-MAX_PRINTED)
    writeStorage(PRINTED_KEY, JSON.stringify(list))
    setPrinted(new Set(list))
  }

  async function handlePrint() {
    if (!placed.size) return
    setBusy(true)
    // Fetch the QR codes afresh if the last try failed, then make sure every one loaded
    flushSync(() => {
      if (failedQr.current) setQrAttempt((n) => n + 1)
      setNotice('Loading the QR codes…')
    })
    const ready = await qrCodesLoaded(wrapRef.current)
    setBusy(false)
    failedQr.current = !ready
    if (!ready) {
      setNotice("A QR code didn't load, so nothing was printed. Check the internet connection and press Print again.")
      return
    }
    setNotice('Printed? Press Mark as cut once the cards are cut out.')
    rememberPrinted([...placed.values()])
    window.print()
  }

  const sheetStyle = {
    transform: scale < 1 ? `scale(${scale})` : undefined,
    marginBottom: scale < 1 ? `${-(1 - scale) * SHEET_H * PX_PER_INCH}px` : undefined,
  }

  const cards = CARD_LAYOUT.slots.map(({ x, y }, s) => {
    const style = place(x, y, CARD_LAYOUT.w, CARD_LAYOUT.h)
    const set = placed.get(s)
    if (set) {
      const first = set.photos[0]
      return (
        <div key={s} className="slot filled" style={style}>
          <QrCard
            title={set.title || fallbackTitle}
            date={formatDate(set.created)}
            result={{ photo: { id: first.id, short_url: first.short_url } }}
            collectionId={collectionId}
            theme={theme}
            decor={showDecor}
            qrAttempt={qrAttempt}
          />
        </div>
      )
    }
    const used = usedSlots.has(s)
    return (
      <button
        type="button"
        key={s}
        className={`slot ${used ? 'used' : 'free'}`}
        style={style}
        onClick={() => toggleSlot(s)}
        title={used ? 'Mark as free' : 'Mark as cut out'}
      >
        {used ? 'Cut out' : 'Free'}
      </button>
    )
  })

  return (
    <div className={`booth qr-page theme-${theme}`}>
      <header className="booth-header">
        <h1>QR codes</h1>
        <p>Pick photos from a collection and print their QR cards on their own sheet.</p>
      </header>

      <div className="booth-layout">
        <aside className="booth-controls" aria-label="QR code settings">
          <Section title="Collection">
            <div className="qr-collection-row">
              <Select value={collectionId} onChange={(e) => changeCollection(e.target.value)} disabled={!collections?.length || busy} aria-label="Collection">
                {collections === null && <option value="">Loading…</option>}
                {collections?.length === 0 && <option value="">No collections yet</option>}
                {collections?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="booth-button qr-refresh"
                onClick={() => {
                  setLoadError('')
                  setReload((n) => n + 1)
                }}
                disabled={!collectionId || loading}
                aria-label="Refresh"
                title="Load the latest photos"
              >
                <LuRefreshCw aria-hidden="true" className={loading ? 'qr-spin' : undefined} />
              </button>
            </div>
            {collections?.length === 0 && (
              <p className="booth-hint">
                Add a collection key in <a href="/admin/settings">Settings</a> first.
              </p>
            )}
          </Section>

          <Section title="Photos">
            {sets.length > 4 && (
              <label className="booth-field">
                <span className="visually-hidden">Search</span>
                <input type="search" placeholder="Search by title or time" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </label>
            )}
            {loadError ? (
              <p className="booth-notice" role="alert">
                {loadError}
              </p>
            ) : loading ? (
              <p className="booth-hint">Loading photos…</p>
            ) : current && sets.length === 0 ? (
              <p className="booth-hint">No photos in this collection yet. Upload some from the Booth or Upload page.</p>
            ) : (
              <ul className="qr-sets" aria-label="Photo sets, newest first">
                {shown.map((set) => {
                  const selected = queue.includes(set.key)
                  const wasPrinted = printed.has(printedKey(set))
                  return (
                    <li key={set.key}>
                      <button type="button" className="qr-set" aria-pressed={selected} onClick={() => toggle(set)} disabled={busy}>
                        <span className="qr-set-thumbs" aria-hidden="true">
                          {set.photos.slice(0, THUMBS_SHOWN).map((p) => (
                            <img key={p.id} src={p.url} alt="" loading="lazy" decoding="async" />
                          ))}
                        </span>
                        <span className="qr-set-text">
                          <span className="qr-set-title">{set.title || fallbackTitle}</span>
                          <span className="qr-set-meta">
                            {formatDate(set.created)} · {formatTime(set.created)} · {set.photos.length} photo{set.photos.length === 1 ? '' : 's'}
                            {wasPrinted && <span className="qr-set-badge">Printed</span>}
                          </span>
                        </span>
                        <span className="qr-set-check" aria-hidden="true">
                          {selected && <LuCheck />}
                        </span>
                      </button>
                    </li>
                  )
                })}
                {query && shown.length === 0 && <li className="booth-hint">Nothing matches “{filter.trim()}”.</li>}
              </ul>
            )}
          </Section>

          <Section title="Design">
            <label className="booth-field">
              <span>Theme</span>
              <Select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
                {THEME_IDS.map((id) => (
                  <option key={id} value={id}>
                    {THEMES[id].label}
                  </option>
                ))}
              </Select>
            </label>
            {themeHasDecor && (
              <Switch checked={decor} onChange={setDecor}>
                Decorations
              </Switch>
            )}
          </Section>

          <Section title="Paper">
            <p className="booth-hint">
              {freeSlots.length === 0
                ? 'This sheet is used up. Load a fresh sheet, then press New sheet.'
                : `${placed.size} card${placed.size === 1 ? '' : 's'} chosen. ${freeSlots.length} of ${CARD_LAYOUT.slots.length} spaces left on this sheet.`}
              {overflow > 0 && ` ${overflow} more chosen than fit; they'll go on the next sheet.`}
            </p>
            <div className="booth-row">
              <button type="button" className="booth-button" onClick={markCut} disabled={busy || placed.size === 0}>
                <LuScissors aria-hidden="true" /> Mark as cut
              </button>
              <button type="button" className="booth-button" onClick={() => saveUsed(new Set())} disabled={busy || usedSlots.size === 0}>
                <LuRotateCcw aria-hidden="true" /> New sheet
              </button>
            </div>
            {queue.length > 0 && (
              <button type="button" className="booth-button wide" onClick={() => setQueue([])} disabled={busy}>
                <LuX aria-hidden="true" /> Clear chosen
              </button>
            )}
            <p className="booth-hint">Tip: click a free or cut-out space on the sheet to switch it.</p>
            <PrintMarginField value={margin} onChange={changeMargin} disabled={busy} />
            <p className="booth-hint">
              Cards print at {printedSize(CARD_LAYOUT, margin)}. If the edges get cut off, make this bigger. Change it only on a fresh sheet.
            </p>
          </Section>

          <div className="booth-print">
            <button type="button" className="booth-button primary wide" onClick={handlePrint} disabled={busy || placed.size === 0}>
              <LuPrinter aria-hidden="true" /> {busy ? 'Loading QR codes…' : placed.size > 1 ? `Print ${placed.size} QR cards` : 'Print QR card'}
            </button>
            <p className="booth-hint">{placed.size ? 'Set the printer to “Actual size” / 100%. One-sided.' : 'Choose photos above to make their QR cards.'}</p>
            {notice && (
              <p className="booth-notice" role="status">
                {notice}
              </p>
            )}
          </div>
        </aside>

        <div className="booth-preview" ref={wrapRef}>
          <div className="booth-sheet" style={sheetStyle}>
            {/* The cards run to the paper's edges, so they're shrunk inside the printer margin */}
            <div className="booth-sheet-inner" style={{ transform: `scale(${marginScale(margin)})` }}>
              {cards}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default QrPage

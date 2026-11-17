import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { LuImagePlus, LuMinus, LuPlus, LuPrinter, LuRotateCcw, LuScissors, LuX } from 'react-icons/lu'
import { Select } from '../Select.tsx'
import {
  CARD_LAYOUT,
  MODES,
  PHOTOS_PER_SET,
  PRINT_H,
  PRINT_SLOTS,
  PRINT_W,
  SHEET_H,
  SHEET_W,
  STRIP_LAYOUT,
  type Mode,
  type SheetLayout,
} from './layouts.ts'
import { Back, Print, QrCard, Strip } from './pieces.tsx'
import { isThemeId, THEME_IDS, THEMES, type ThemeId } from './themes.ts'
import { displayablePhoto, isPhotoFile, looksLikeHeic, PHOTO_ACCEPT, useCollections } from '../rankuogClient.ts'
import { stripLabel, uploadPhotos, type UploadResult, type UploadState } from './upload.ts'
import './booth.css'

const PX_PER_INCH = 96
// How long to wait for the QR codes to load before giving up on printing
const QR_TIMEOUT_MS = 15_000

type Photo = { file: File; url: string }

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable; the setting just won't be remembered
  }
}

function loadUsed(layout: SheetLayout): Set<number> {
  try {
    const saved: unknown = JSON.parse(readStorage(layout.storageKey) ?? '[]')
    if (Array.isArray(saved)) return new Set(saved.filter((n): n is number => typeof n === 'number'))
  } catch {
    // Invalid saved value; start with a fresh sheet
  }
  return new Set()
}

const isMode = (value: string | null): value is Mode => MODES.some((m) => m.mode === value)

/** Positions a piece on the sheet; sizes in inches */
function place(x: number, y: number, w: number, h: number) {
  return { left: `${x}in`, top: `${y}in`, width: `${w}in`, height: `${h}in` }
}

// A back lands behind its front when the printer flips the sheet on its long edge: same row, mirrored
function placeBack(x: number, y: number, w: number, h: number) {
  return place(SHEET_W - x - w, y, w, h)
}

/**
 * True once every QR code on the sheets has loaded. A QR code that fails, or takes longer than
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="booth-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Switch({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="booth-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="booth-switch-track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  )
}

function Booth() {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = readStorage('photo-strip-mode')
    return isMode(saved) ? saved : 'strips'
  })
  // One entry per photo position, so a single box can be filled, changed or cleared on its own
  const [photos, setPhotos] = useState<(Photo | undefined)[]>(() => Array.from({ length: PHOTOS_PER_SET }, () => undefined))
  const [title, setTitle] = useState(() => readStorage('booth-title') ?? 'UGSM')
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = readStorage('booth-theme')
    return isThemeId(saved) ? saved : 'classic'
  })
  const [sessions, setSessions] = useState(1)
  const [decor, setDecor] = useState(() => readStorage('photo-strip-decor') !== 'off')
  const [qr, setQr] = useState(() => readStorage('photo-strip-qr') !== 'off')
  const collections = useCollections()
  const [chosenCollection, setCollectionId] = useState(() => readStorage('booth-collection') ?? '')
  // The saved choice if it still exists, otherwise the first collection
  const collectionId = collections?.some((c) => c.id === chosenCollection) ? chosenCollection : (collections?.[0]?.id ?? '')
  // Cut-out slots on the current sheet, remembered separately for strips and cards
  const [used, setUsed] = useState(() => ({ strips: loadUsed(STRIP_LAYOUT), cards: loadUsed(CARD_LAYOUT) }))
  const [results, setResults] = useState<UploadResult[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(1)
  const [qrAttempt, setQrAttempt] = useState(0)

  const uploadRef = useRef<UploadState | null>(null)
  // Set when the last print stopped because a QR code didn't load
  const failedQr = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const photosRef = useRef(photos)
  const singleInputRef = useRef<HTMLInputElement>(null)
  const pickIndexRef = useRef(0)
  // Today's date for the strip footer, worked out once when the page opens
  const [date] = useState(() => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))

  // Settings that should survive a reload
  useEffect(() => writeStorage('photo-strip-mode', mode), [mode])
  useEffect(() => writeStorage('booth-title', title), [title])
  useEffect(() => writeStorage('booth-theme', theme), [theme])
  useEffect(() => writeStorage('photo-strip-decor', decor ? 'on' : 'off'), [decor])
  useEffect(() => writeStorage('photo-strip-qr', qr ? 'on' : 'off'), [qr])
  useEffect(() => {
    if (collectionId) writeStorage('booth-collection', collectionId)
  }, [collectionId])

  // Release photo previews when the page closes
  useEffect(() => {
    photosRef.current = photos
  }, [photos])
  useEffect(() => () => photosRef.current.forEach((p) => p && URL.revokeObjectURL(p.url)), [])

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

  const photoUrls = photos.map((p) => p?.url)
  // Positions that have a photo, in order; uploads go in this order, so results[k] belongs to filledIndexes[k]
  const filledIndexes = photos.flatMap((p, i) => (p ? [i] : []))
  const photoCount = filledIndexes.length
  const digitalOnly = mode === 'cards'
  const sheetMode = mode === 'prints' ? null : mode
  const layout = sheetMode === 'strips' ? STRIP_LAYOUT : sheetMode === 'cards' ? CARD_LAYOUT : null
  const usedSlots = sheetMode ? used[sheetMode] : new Set<number>()
  const freeGroups = layout ? layout.groups.filter((g) => g.every((slot) => !usedSlots.has(slot))) : []
  const sessionCount = Math.max(1, Math.min(freeGroups.length, sessions))
  const filled = new Set(freeGroups.slice(0, sessionCount).flat())
  const sheetFull = layout !== null && freeGroups.length === 0
  // Digital only always uploads: the QR card is the whole point
  const uploading = qr || digitalOnly
  const needsPhotos = digitalOnly && photoCount === 0
  const firstResult = results[0]
  const themeHasDecor = Object.keys(THEMES[theme].decor).length > 0
  const showDecor = decor && themeHasDecor
  function resetUpload() {
    uploadRef.current = null
    setResults([])
  }

  // Puts files into the given positions, releasing the previews they replace
  function placePhotos(entries: [number, File | undefined][]) {
    if (!entries.length) return
    setPhotos((prev) => {
      const next = [...prev]
      for (const [index, file] of entries) {
        const old = next[index]
        if (old) URL.revokeObjectURL(old.url)
        next[index] = file ? { file, url: URL.createObjectURL(file) } : undefined
      }
      return next
    })
    resetUpload()
    setNotice('')
  }

  // Every new photo comes through here, so HEIC (iPhone) photos are turned into something the page can show
  async function addPhotos(entries: [number, File][]) {
    if (!entries.length) return
    if (entries.some(([, file]) => looksLikeHeic(file))) setNotice('Converting HEIC photo…')
    const ready: [number, File][] = []
    let failed = 0
    for (const [index, file] of entries) {
      try {
        ready.push([index, await displayablePhoto(file)])
      } catch {
        failed++
      }
    }
    placePhotos(ready)
    if (failed) setNotice(`Couldn't open ${failed} photo${failed === 1 ? '' : 's'}. Try exporting ${failed === 1 ? 'it' : 'them'} as JPEG.`)
  }

  // Several photos at once fill the empty boxes in order; if none are empty, they replace from box 1
  function chooseMany(files: FileList | null) {
    const images = Array.from(files ?? []).filter(isPhotoFile)
    const empty = photos.flatMap((p, i) => (p ? [] : [i]))
    const targets = empty.length ? empty : photos.map((_, i) => i)
    void addPhotos(images.slice(0, targets.length).map((file, k): [number, File] => [targets[k], file]))
  }

  const photoActions = {
    onPick: (index: number) => {
      pickIndexRef.current = index
      singleInputRef.current?.click()
    },
    onDropFile: (index: number, file: File) => void addPhotos([[index, file]]),
  }

  const pieceProps = { photoUrls, title, date, theme, decor: showDecor, actions: photoActions }

  function saveUsed(next: Set<number>) {
    if (!layout || !sheetMode) return
    writeStorage(layout.storageKey, JSON.stringify([...next]))
    setUsed((prev) => ({ ...prev, [sheetMode]: next }))
  }

  function togglePair(slot: number) {
    const group = layout?.groups.find((g) => g.includes(slot))
    if (!group) return
    const next = new Set(usedSlots)
    if (group.some((s) => next.has(s))) group.forEach((s) => next.delete(s))
    else group.forEach((s) => next.add(s))
    saveUsed(next)
  }

  async function handlePrint() {
    if (uploading && photoCount) {
      if (!collectionId) {
        setNotice(digitalOnly ? 'Choose a collection to upload to.' : 'Choose a collection to upload to, or turn off the QR code.')
        return
      }
      if (uploadRef.current?.collectionId !== collectionId) {
        uploadRef.current = { collectionId, strip: stripLabel(title), results: [] }
      }
      const state = uploadRef.current
      setBusy(true)
      try {
        await uploadPhotos(state, filledIndexes.map((i) => (photos[i] as Photo).file), title, setNotice)
      } catch (err) {
        setResults([...state.results])
        const fallback = digitalOnly ? '' : ' Turn off the QR code to print without it.'
        setNotice(`${err instanceof Error ? err.message : 'Upload failed.'}${fallback}`)
        setBusy(false)
        return
      }
      // Show the QR codes (fetching them afresh if this is a retry), then make sure every one loaded
      flushSync(() => {
        setResults([...state.results])
        if (failedQr.current) setQrAttempt((n) => n + 1)
        setNotice('Photos uploaded. Loading the QR codes…')
      })
      const ready = await qrCodesLoaded(wrapRef.current)
      setBusy(false)
      failedQr.current = !ready
      if (!ready) {
        setNotice(
          "The photos uploaded, but a QR code didn't load, so nothing was printed. Check the internet connection and press Print again; the photos won't upload twice.",
        )
        return
      }
      setNotice('Photos uploaded')
    }
    window.print()
  }

  let frontPieces: ReactNode
  let backPieces: ReactNode
  if (layout) {
    frontPieces = layout.slots.map(({ x, y }, s) => {
      const style = place(x, y, layout.w, layout.h)
      // A strip being printed holds the photo buttons; empty and cut-out spaces toggle when clicked
      if (filled.has(s)) {
        return (
          <div key={s} className="slot filled" style={style}>
            {digitalOnly ? (
              <QrCard
                title={title}
                date={date}
                result={firstResult}
                collectionId={collectionId}
                hasPhotos={photoCount > 0}
                theme={theme}
                decor={showDecor}
                qrAttempt={qrAttempt}
              />
            ) : (
              <Strip {...pieceProps} />
            )}
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
          onClick={() => togglePair(s)}
          title={used ? 'Mark as free' : 'Mark as cut out'}
        >
          {used ? 'Cut out' : 'Free'}
        </button>
      )
    })
    backPieces = digitalOnly ? null : [...filled].map((s) => (
      <div key={s} className="back" style={placeBack(layout.slots[s].x, layout.slots[s].y, layout.w, layout.h)}>
        <Back title={title} result={firstResult} collectionId={collectionId} hasPhotos={photoCount > 0} theme={theme} decor={showDecor} qrAttempt={qrAttempt} />
      </div>
    ))
  } else {
    frontPieces = PRINT_SLOTS.map(({ x, y }, i) => (
      <div key={i} className="slot filled" style={place(x, y, PRINT_W, PRINT_H)}>
        <Print {...pieceProps} index={i} />
      </div>
    ))
    backPieces = PRINT_SLOTS.map(({ x, y }, i) => (
      <div key={i} className="back" style={placeBack(x, y, PRINT_W, PRINT_H)}>
        <Back
          title={title}
          result={results[filledIndexes.indexOf(i)] ?? firstResult}
          collectionId={collectionId}
          hasPhotos={photoCount > 0}
          theme={theme}
          decor={showDecor}
          qrAttempt={qrAttempt}
        />
      </div>
    ))
  }

  const sheetStyle = {
    transform: scale < 1 ? `scale(${scale})` : undefined,
    marginBottom: scale < 1 ? `${-(1 - scale) * SHEET_H * PX_PER_INCH}px` : undefined,
  }

  const printLabel = busy ? 'Uploading…' : digitalOnly ? 'Upload & print QR card' : qr && photoCount ? 'Upload & print' : 'Print'
  const showBack = qr && !digitalOnly

  return (
    <div className={`booth mode-${mode} theme-${theme}`}>
      <header className="booth-header">
        <h1>Photo booth</h1>
        <p>Lay out photos on Letter paper, then print.</p>
      </header>

      <div className="booth-layout">
        <aside className="booth-controls" aria-label="Photo booth settings">
          <Section title="Layout">
            <div className="booth-segmented" role="radiogroup" aria-label="Layout">
              {MODES.map(({ mode: m, label, detail }) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => {
                    setMode(m)
                    setSessions(1)
                  }}>
                  <span className="booth-segmented-label">{label}</span>
                  <span className="booth-segmented-detail">{detail}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Photos">
            <ol className="booth-thumbs" aria-label={`${photoCount} of ${PHOTOS_PER_SET} photos chosen`}>
              {photos.map((photo, i) => (
                <li key={i} className={photo ? 'has-photo' : undefined}>
                  <button
                    type="button"
                    className="booth-thumb"
                    onClick={() => photoActions.onPick(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      const file = Array.from(e.dataTransfer.files).find(isPhotoFile)
                      if (file) void addPhotos([[i, file]])
                    }}
                    aria-label={photo ? `Change photo ${i + 1}` : `Add photo ${i + 1}`}
                    title={photo ? 'Change this photo' : 'Add a photo here'}
                  >
                    {photo ? <img src={photo.url} alt="" /> : <LuPlus aria-hidden="true" />}
                    <span className="booth-thumb-number">{i + 1}</span>
                  </button>
                  {photo && (
                    <button
                      type="button"
                      className="booth-thumb-remove"
                      onClick={() => placePhotos([[i, undefined]])}
                      aria-label={`Remove photo ${i + 1}`}
                      title="Remove"
                    >
                      <LuX aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <label className="booth-button wide" htmlFor="booth-photos">
              <LuImagePlus aria-hidden="true" /> {photoCount === PHOTOS_PER_SET ? 'Replace all photos' : 'Choose photos'}
            </label>
            <input
              id="booth-photos"
              type="file"
              accept={PHOTO_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                chooseMany(e.target.files)
                e.target.value = ''
              }}
            />
            {/* Used when one box is clicked, here or in the preview */}
            <input
              ref={singleInputRef}
              type="file"
              accept={PHOTO_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void addPhotos([[pickIndexRef.current, file]])
                e.target.value = ''
              }}
            />
            <p className="booth-hint">Click a box, here or on the sheet, to add or change that photo. You can also drag a photo onto it.</p>
          </Section>

          <Section title="Design">
            <label className="booth-field">
              <span>Title</span>
              <input type="text" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
            </label>
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

          {layout && (
            <Section title="Paper">
              <div className="booth-stepper">
                <span id="booth-sessions-label">{digitalOnly ? 'Cards to print' : 'Sessions to print'}</span>
                <div role="group" aria-labelledby="booth-sessions-label">
                  <button
                    type="button"
                    aria-label="Fewer sessions"
                    onClick={() => setSessions(sessionCount - 1)}
                    disabled={sheetFull || sessionCount <= 1}
                  >
                    <LuMinus aria-hidden="true" />
                  </button>
                  <output aria-live="polite">{sheetFull ? 0 : sessionCount}</output>
                  <button
                    type="button"
                    aria-label="More sessions"
                    onClick={() => setSessions(sessionCount + 1)}
                    disabled={sheetFull || sessionCount >= freeGroups.length}
                  >
                    <LuPlus aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="booth-hint">
                {sheetFull
                  ? 'This sheet is used up. Load a fresh sheet, then press New sheet.'
                  : `${digitalOnly ? 'Each session is one QR card.' : 'Each session is 2 strips side by side.'} ${freeGroups.length} of ${layout.groups.length} left on this sheet.`}
              </p>
              <div className="booth-row">
                <button
                  type="button"
                  className="booth-button"
                  onClick={() => saveUsed(new Set([...usedSlots, ...filled]))}
                  disabled={busy || sheetFull}
                >
                  <LuScissors aria-hidden="true" /> Mark as cut
                </button>
                <button type="button" className="booth-button" onClick={() => saveUsed(new Set())} disabled={busy || usedSlots.size === 0}>
                  <LuRotateCcw aria-hidden="true" /> New sheet
                </button>
              </div>
              <p className="booth-hint">Tip: click a free or cut-out space on the sheet to switch it.</p>
            </Section>
          )}

          <Section title="QR code">
            {!digitalOnly && (
              <Switch checked={qr} onChange={setQr}>
                Print a QR code on the back
              </Switch>
            )}
            {uploading && (
              <>
                <label className="booth-field">
                  <span>Upload photos to</span>
                  <Select
                    value={collectionId}
                    onChange={(e) => {
                      setCollectionId(e.target.value)
                      resetUpload()
                    }}
                    disabled={!collections?.length || busy}
                  >
                    {collections === null && <option value="">Loading…</option>}
                    {collections?.length === 0 && <option value="">No collections yet</option>}
                    {collections?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <p className="booth-hint">
                  {collections?.length === 0 ? (
                    <>
                      Add a collection key in <a href="/admin/settings">Settings</a> first.
                    </>
                  ) : digitalOnly ? (
                    'The photos upload, then only a small card with the QR code prints. No photos go on paper.'
                  ) : (
                    'Photos upload when you print. Print two-sided and flip on the long edge.'
                  )}
                </p>
              </>
            )}
          </Section>

          <div className="booth-print">
            <button type="button" className="booth-button primary wide" onClick={handlePrint} disabled={busy || sheetFull || needsPhotos}>
              <LuPrinter aria-hidden="true" /> {printLabel}
            </button>
            <p className="booth-hint">
              {needsPhotos ? 'Add at least one photo to make a QR card.' : 'Set the printer to “Actual size” / 100%.'}
            </p>
            {notice && (
              <p className="booth-notice" role="status">
                {notice}
              </p>
            )}
          </div>
        </aside>

        <div className="booth-preview" ref={wrapRef}>
          {showBack && <p className="booth-sheet-label">Front</p>}
          <div className="booth-sheet" style={sheetStyle}>
            {frontPieces}
          </div>
          {showBack && (
            <>
              <p className="booth-sheet-label">Back · prints on the reverse side</p>
              <div className="booth-sheet booth-sheet-back" style={sheetStyle}>
                {backPieces}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Booth

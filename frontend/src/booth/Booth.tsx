import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LuImagePlus, LuMinus, LuPlus, LuPrinter, LuRotateCcw, LuScissors, LuX } from 'react-icons/lu'
import { Select } from '../Select.tsx'
import {
  CENTERED,
  MODES,
  PHOTOS_PER_SET,
  PRINT_H,
  PRINT_SLOTS,
  PRINT_W,
  SHEET_H,
  SHEET_W,
  STRIP_LAYOUT,
  type Mode,
  type PhotoPosition,
} from './layouts.ts'
import { Print, Strip } from './pieces.tsx'
import { PrintMarginField, Section, Switch } from './controls.tsx'
import { loadPrintMargin, loadUsed, marginScale, printedSize, PX_PER_INCH, place, readStorage, savePrintMargin, writeStorage } from './storage.ts'
import { isThemeId, THEME_IDS, THEMES, type ThemeId } from './themes.ts'
import { displayablePhoto, isPhotoFile, looksLikeHeic, PHOTO_ACCEPT, useCollections } from '../rankuogClient.ts'
import { stripLabel, uploadPhotos, type UploadState } from './upload.ts'
import './booth.css'

// position: which part of the photo shows when it's cropped to its box; reset when the photo changes
type Photo = { file: File; url: string; position: PhotoPosition }

const isMode = (value: string | null): value is Mode => MODES.some((m) => m.mode === value)

/** Today in the local time zone, as YYYY-MM-DD (the value a date input uses) */
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Nov 17, 2026" (in the browser's own style) from YYYY-MM-DD; empty for no date */
function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return ''
  // Built from its parts so it stays on that day; new Date('YYYY-MM-DD') would be midnight UTC
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
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
  const [upload, setUpload] = useState(() => readStorage('booth-upload') !== 'off')
  const collections = useCollections()
  const [chosenCollection, setCollectionId] = useState(() => readStorage('booth-collection') ?? '')
  // The saved choice if it still exists, otherwise the first collection
  const collectionId = collections?.some((c) => c.id === chosenCollection) ? chosenCollection : (collections?.[0]?.id ?? '')
  // Cut-out slots on the current strip sheet
  const [usedSlots, setUsedSlots] = useState(() => loadUsed(STRIP_LAYOUT))
  const [margin, setMargin] = useState(loadPrintMargin)
  function changeMargin(next: number) {
    setMargin(next)
    savePrintMargin(next)
  }
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(1)

  const uploadRef = useRef<UploadState | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const photosRef = useRef(photos)
  const singleInputRef = useRef<HTMLInputElement>(null)
  const pickIndexRef = useRef(0)
  // The strip footer's date, as YYYY-MM-DD. Starts as today each time the page opens; empty leaves it off.
  const [dateValue, setDateValue] = useState(todayIso)
  const date = formatDate(dateValue)

  // Settings that should survive a reload
  useEffect(() => writeStorage('photo-strip-mode', mode), [mode])
  useEffect(() => writeStorage('booth-title', title), [title])
  useEffect(() => writeStorage('booth-theme', theme), [theme])
  useEffect(() => writeStorage('photo-strip-decor', decor ? 'on' : 'off'), [decor])
  useEffect(() => writeStorage('booth-upload', upload ? 'on' : 'off'), [upload])
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
  const positions = photos.map((p) => p?.position)
  const filledIndexes = photos.flatMap((p, i) => (p ? [i] : []))
  const photoCount = filledIndexes.length
  const layout = mode === 'strips' ? STRIP_LAYOUT : null
  const freeGroups = layout ? layout.groups.filter((g) => g.every((slot) => !usedSlots.has(slot))) : []
  const sessionCount = Math.max(1, Math.min(freeGroups.length, sessions))
  const filled = new Set(freeGroups.slice(0, sessionCount).flat())
  const sheetFull = layout !== null && freeGroups.length === 0
  const themeHasDecor = Object.keys(THEMES[theme].decor).length > 0
  const showDecor = decor && themeHasDecor
  function resetUpload() {
    uploadRef.current = null
  }

  // Puts files into the given positions, releasing the previews they replace
  function placePhotos(entries: [number, File | undefined][]) {
    if (!entries.length) return
    setPhotos((prev) => {
      const next = [...prev]
      for (const [index, file] of entries) {
        const old = next[index]
        if (old) URL.revokeObjectURL(old.url)
        next[index] = file ? { file, url: URL.createObjectURL(file), position: CENTERED } : undefined
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
    // Only how the photo is cropped on paper changes, so an upload already done still stands
    onMove: (index: number, position: PhotoPosition) =>
      setPhotos((prev) => prev.map((p, i) => (i === index && p ? { ...p, position } : p))),
  }

  const pieceProps = { photoUrls, positions, title, date, theme, decor: showDecor, actions: photoActions }

  function saveUsed(next: Set<number>) {
    writeStorage(STRIP_LAYOUT.storageKey, JSON.stringify([...next]))
    setUsedSlots(next)
  }

  function togglePair(slot: number) {
    const group = layout?.groups.find((g) => g.includes(slot))
    if (!group) return
    const next = new Set(usedSlots)
    if (group.some((s) => next.has(s))) group.forEach((s) => next.delete(s))
    else group.forEach((s) => next.add(s))
    saveUsed(next)
  }

  // Uploads first (a retry carries on where it stopped, so nothing goes up twice), then prints.
  // The QR code for these photos is printed separately, from the QR codes page.
  async function handlePrint() {
    if (upload && photoCount) {
      if (!collectionId) {
        setNotice('Choose a collection to upload to, or turn off uploading.')
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
        setNotice(`${err instanceof Error ? err.message : 'Upload failed.'} Press Print to try again, or turn off uploading to print without it.`)
        return
      } finally {
        setBusy(false)
      }
      const label = collections?.find((c) => c.id === collectionId)?.label ?? 'the collection'
      setNotice(`Photos uploaded to ${label}. Print their QR card from the QR codes page.`)
    }
    window.print()
  }

  const frontPieces: ReactNode = layout
    ? layout.slots.map(({ x, y }, s) => {
        const style = place(x, y, layout.w, layout.h)
        // A strip being printed holds the photo buttons; empty and cut-out spaces toggle when clicked
        if (filled.has(s)) {
          return (
            <div key={s} className="slot filled" style={style}>
              <Strip {...pieceProps} />
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
    : PRINT_SLOTS.map(({ x, y }, i) => (
        <div key={i} className="slot filled" style={place(x, y, PRINT_W, PRINT_H)}>
          <Print {...pieceProps} index={i} />
        </div>
      ))

  const sheetStyle = {
    transform: scale < 1 ? `scale(${scale})` : undefined,
    marginBottom: scale < 1 ? `${-(1 - scale) * SHEET_H * PX_PER_INCH}px` : undefined,
  }

  const printLabel = busy ? 'Uploading…' : upload && photoCount ? 'Upload & print' : 'Print'

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
                    {photo ? (
                      <img src={photo.url} alt="" style={{ objectPosition: `${photo.position.x}% ${photo.position.y}%` }} />
                    ) : (
                      <LuPlus aria-hidden="true" />
                    )}
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
            <div className="booth-field">
              <label htmlFor="booth-date">Date</label>
              <div className="booth-field-row">
                <input id="booth-date" type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
                <button
                  type="button"
                  className="booth-button"
                  onClick={() => setDateValue(todayIso())}
                  disabled={dateValue === todayIso()}
                  title="Use today's date"
                >
                  Today
                </button>
              </div>
              <p className="booth-hint">Clear it to leave the date off.</p>
            </div>
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
                <span id="booth-sessions-label">Sessions to print</span>
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
                  : `Each session is 2 strips side by side. ${freeGroups.length} of ${layout.groups.length} left on this sheet.`}
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
              <PrintMarginField value={margin} onChange={changeMargin} disabled={busy} />
              <p className="booth-hint">
                Strips print at {printedSize(layout, margin)}. If the edges get cut off, make this bigger. Change it only on a fresh sheet.
              </p>
            </Section>
          )}

          <Section title="Upload">
            <Switch checked={upload} onChange={setUpload}>
              Upload the photos when printing
            </Switch>
            {upload && (
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
            )}
            <p className="booth-hint">
              {upload && collections?.length === 0 ? (
                <>
                  Add a collection key in <a href="/admin/settings">Settings</a> first.
                </>
              ) : (
                <>
                  QR codes print separately: open <a href="/admin/qr">QR codes</a>, pick the collection and choose these photos.
                </>
              )}
            </p>
          </Section>

          <div className="booth-print">
            <button type="button" className="booth-button primary wide" onClick={handlePrint} disabled={busy || sheetFull}>
              <LuPrinter aria-hidden="true" /> {printLabel}
            </button>
            <p className="booth-hint">Set the printer to “Actual size” / 100%.</p>
            {notice && (
              <p className="booth-notice" role="status">
                {notice}
              </p>
            )}
          </div>
        </aside>

        <div className="booth-preview" ref={wrapRef}>
          <div className="booth-sheet" style={sheetStyle}>
            {/* Strips run to the paper's edges, so they're shrunk inside the printer margin; 4 × 5 prints already sit inside it */}
            <div className="booth-sheet-inner" style={layout ? { transform: `scale(${marginScale(margin)})` } : undefined}>
              {frontPieces}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Booth

import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { isPhotoFile } from '../rankuogClient.ts'
import { CENTERED, PHOTOS_PER_SET, type PhotoPosition } from './layouts.ts'
import { THEMES, type Decor, type ThemeId } from './themes.ts'
import { qrSrc, type UploadResult } from './upload.ts'

// Each icon is placed by its spot's class in booth.css (.decor-top-left and so on)
function Decorations({ spots }: { spots: Partial<Record<string, Decor>> }) {
  return (
    <>
      {Object.entries(spots).map(([spot, decor]) => {
        if (!decor) return null
        const Icon = decor.icon
        return <Icon key={spot} className={`decor decor-${spot}`} color={decor.color} aria-hidden="true" />
      })}
    </>
  )
}

/** What happens when a photo box is clicked, dragged, or has a file dropped on it */
export type PhotoActions = {
  onPick: (index: number) => void
  onDropFile: (index: number, file: File) => void
  /** The photo was moved within its box */
  onMove: (index: number, position: PhotoPosition) => void
}

function imageFromDrop(e: DragEvent<HTMLElement>): File | undefined {
  return Array.from(e.dataTransfer.files).find(isPhotoFile)
}

// A press that moves less than this (in screen pixels) is a click, which changes the photo
const DRAG_THRESHOLD = 4
// How far one arrow-key press moves a photo, in percent
const NUDGE = 5

const clamp = (n: number) => Math.min(100, Math.max(0, n))

type Pan = {
  startX: number
  startY: number
  from: PhotoPosition
  /** How far, in screen pixels, the photo overhangs its box in each direction; 0 means it can't move that way */
  rangeX: number
  rangeY: number
  moved: boolean
}

/**
 * On screen each box is a button: click to choose or change the photo, drag (or use the arrow keys)
 * to move it within the box. The hint text is hidden when printing; the position isn't.
 */
function Photo({ url, index, position = CENTERED, actions }: { url?: string; index: number; position?: PhotoPosition; actions: PhotoActions }) {
  const [dropping, setDropping] = useState(false)
  const [panning, setPanning] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const pan = useRef<Pan | null>(null)
  // Set when a press turned into a drag, so the click that follows doesn't open the file picker
  const suppressClick = useRef(false)

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false
    const img = imgRef.current
    if (!url || !img?.naturalWidth || e.button !== 0) return
    // The image is scaled to cover the box, so it overhangs on one side; that overhang is how far it can move
    const box = e.currentTarget.getBoundingClientRect()
    const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight)
    pan.current = {
      startX: e.clientX,
      startY: e.clientY,
      from: position,
      rangeX: img.naturalWidth * scale - box.width,
      rangeY: img.naturalHeight * scale - box.height,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const p = pan.current
    if (!p) return
    const dx = e.clientX - p.startX
    const dy = e.clientY - p.startY
    if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!p.moved) {
      p.moved = true
      setPanning(true)
    }
    // Dragging right pulls the photo right, which shows more of its left side
    actions.onMove(index, {
      x: p.rangeX > 0.5 ? clamp(p.from.x - (dx / p.rangeX) * 100) : p.from.x,
      y: p.rangeY > 0.5 ? clamp(p.from.y - (dy / p.rangeY) * 100) : p.from.y,
    })
  }

  function endPan() {
    suppressClick.current = Boolean(pan.current?.moved)
    pan.current = null
    setPanning(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!url) return
    const step = { ArrowLeft: [NUDGE, 0], ArrowRight: [-NUDGE, 0], ArrowUp: [0, NUDGE], ArrowDown: [0, -NUDGE] }[e.key]
    if (!step) return
    e.preventDefault()
    actions.onMove(index, { x: clamp(position.x + step[0]), y: clamp(position.y + step[1]) })
  }

  return (
    <button
      type="button"
      className={`photo${url ? ' has-photo' : ''}${dropping ? ' dragging' : ''}${panning ? ' panning' : ''}`}
      onClick={() => {
        if (suppressClick.current) suppressClick.current = false
        else actions.onPick(index)
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const file = imageFromDrop(e)
        if (file) actions.onDropFile(index, file)
      }}
      aria-label={url ? `Photo ${index + 1}: click to change, drag or use the arrow keys to move it` : `Add photo ${index + 1}`}
    >
      {url ? (
        <img ref={imgRef} src={url} alt="" draggable={false} style={{ objectPosition: `${position.x}% ${position.y}%` }} />
      ) : (
        <span className="photo-empty">
          {index + 1}
          <span className="photo-hint">Add photo</span>
        </span>
      )}
      {url && <span className="photo-hint photo-change">Drag to move · click to change</span>}
    </button>
  )
}

function Footer({ title, date }: { title: string; date: string }) {
  return (
    <div className="footer">
      <div className="title">{title}</div>
      {date && <div className="date">{date}</div>}
    </div>
  )
}

type CommonProps = {
  photoUrls: (string | undefined)[]
  positions: (PhotoPosition | undefined)[]
  title: string
  date: string
  theme: ThemeId
  decor: boolean
  actions: PhotoActions
}

/** 2.125 × 5.5 in: four photos stacked, then the title */
export function Strip({ photoUrls, positions, title, date, theme, decor, actions }: CommonProps) {
  return (
    <div className="strip">
      {Array.from({ length: PHOTOS_PER_SET }, (_, i) => (
        <Photo key={i} url={photoUrls[i]} index={i} position={positions[i]} actions={actions} />
      ))}
      <Footer title={title} date={date} />
      {decor && <Decorations spots={THEMES[theme].decor} />}
    </div>
  )
}

/** 4 × 5 in: one photo and the title */
export function Print({ photoUrls, positions, title, date, theme, decor, actions, index }: CommonProps & { index: number }) {
  return (
    <div className="strip print">
      <Photo url={photoUrls[index]} index={index} position={positions[index]} actions={actions} />
      <Footer title={title} date={date} />
      {decor && <Decorations spots={THEMES[theme].decor} />}
    </div>
  )
}

type QrCardProps = {
  title: string
  date: string
  /** The photo the QR code opens; without one the card shows a placeholder */
  result: UploadResult | undefined
  collectionId: string
  theme: ThemeId
  decor: boolean
  /** Bumped when printing is retried after a QR code failed to load */
  qrAttempt: number
}

/** A small card, printed on its own sheet, with a QR code that opens the uploaded photos */
export function QrCard({ title, date, result, collectionId, theme, decor, qrAttempt }: QrCardProps) {
  return (
    <div className="qr-card">
      <div className="title">{title}</div>
      {result ? (
        <div className="qr">
          <img src={qrSrc(result, collectionId, qrAttempt)} alt="QR code for your photos" />
        </div>
      ) : (
        <div className="qr placeholder">QR code goes here</div>
      )}
      <div className="caption">Scan for your photos</div>
      {result?.photo.short_url && <div className="link">{result.photo.short_url.replace(/^https?:\/\//, '')}</div>}
      <div className="date">{date}</div>
      {decor && <Decorations spots={THEMES[theme].backDecor} />}
    </div>
  )
}

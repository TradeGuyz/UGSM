import { useState, type DragEvent } from 'react'
import { isPhotoFile } from '../rankuogClient.ts'
import { PHOTOS_PER_SET } from './layouts.ts'
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

/** What happens when a photo box is clicked or has a file dropped on it */
export type PhotoActions = {
  onPick: (index: number) => void
  onDropFile: (index: number, file: File) => void
}

function imageFromDrop(e: DragEvent<HTMLElement>): File | undefined {
  return Array.from(e.dataTransfer.files).find(isPhotoFile)
}

// On screen each box is a button for choosing that photo; the hint text is hidden when printing
function Photo({ url, index, actions }: { url?: string; index: number; actions: PhotoActions }) {
  const [dragging, setDragging] = useState(false)
  return (
    <button
      type="button"
      className={`photo${url ? ' has-photo' : ''}${dragging ? ' dragging' : ''}`}
      onClick={() => actions.onPick(index)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = imageFromDrop(e)
        if (file) actions.onDropFile(index, file)
      }}
      aria-label={url ? `Change photo ${index + 1}` : `Add photo ${index + 1}`}
    >
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="photo-empty">
          {index + 1}
          <span className="photo-hint">Add photo</span>
        </span>
      )}
      {url && <span className="photo-hint photo-change">Change</span>}
    </button>
  )
}

function Footer({ title, date }: { title: string; date: string }) {
  return (
    <div className="footer">
      <div className="title">{title}</div>
      <div className="date">{date}</div>
    </div>
  )
}

type CommonProps = {
  photoUrls: (string | undefined)[]
  title: string
  date: string
  theme: ThemeId
  decor: boolean
  actions: PhotoActions
}

/** 2.125 × 5.5 in: four photos stacked, then the title */
export function Strip({ photoUrls, title, date, theme, decor, actions }: CommonProps) {
  return (
    <div className="strip">
      {Array.from({ length: PHOTOS_PER_SET }, (_, i) => (
        <Photo key={i} url={photoUrls[i]} index={i} actions={actions} />
      ))}
      <Footer title={title} date={date} />
      {decor && <Decorations spots={THEMES[theme].decor} />}
    </div>
  )
}

/** 4 × 5 in: one photo and the title */
export function Print({ photoUrls, title, date, theme, decor, actions, index }: CommonProps & { index: number }) {
  return (
    <div className="strip print">
      <Photo url={photoUrls[index]} index={index} actions={actions} />
      <Footer title={title} date={date} />
      {decor && <Decorations spots={THEMES[theme].decor} />}
    </div>
  )
}

type BackProps = {
  title: string
  result: UploadResult | undefined
  collectionId: string
  hasPhotos: boolean
  theme: ThemeId
  decor: boolean
  /** Bumped when printing is retried after a QR code failed to load */
  qrAttempt: number
}

/** The reverse side: a QR code that opens the uploaded photos */
export function Back({ title, result, collectionId, hasPhotos, theme, decor, qrAttempt }: BackProps) {
  return (
    <>
      <div className="title">{title}</div>
      {result ? (
        <div className="qr">
          <img src={qrSrc(result, collectionId, qrAttempt)} alt="QR code for your photos" />
        </div>
      ) : (
        <div className="qr placeholder">{hasPhotos ? 'QR is made when you print' : 'QR code goes here'}</div>
      )}
      <div className="caption">Scan for your photos</div>
      {result?.photo.short_url && <div className="link">{result.photo.short_url.replace(/^https?:\/\//, '')}</div>}
      {decor && <Decorations spots={THEMES[theme].backDecor} />}
    </>
  )
}

/** Digital only: a small card with just the QR code, for people who don't want prints */
export function QrCard({ date, ...back }: BackProps & { date: string }) {
  return (
    <div className="qr-card">
      <Back {...back} />
      <div className="date">{date}</div>
    </div>
  )
}

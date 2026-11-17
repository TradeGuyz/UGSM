import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  LuCircleAlert,
  LuCircleCheck,
  LuCloudUpload,
  LuExternalLink,
  LuFolderOpen,
  LuImages,
  LuLoaderCircle,
  LuRotateCw,
  LuSquare,
  LuX,
} from 'react-icons/lu'
import { Select } from '../Select.tsx'
import { looksLikeHeic, PHOTO_ACCEPT, prepareImage, sendPhoto, useCollections } from '../rankuogClient.ts'
import { filesFromDrop, filesFromInput, type Found, type FoundFile } from './files.ts'
import './upload.css'

type Status = 'queued' | 'uploading' | 'done' | 'failed'

type Item = {
  id: string
  file: File
  /** Where it came from, including folders, e.g. "Graduation/Stage/IMG_0042.jpg" */
  path: string
  preview: string
  status: Status
  progress: number
  error?: string
  link?: string
}

const PARALLEL_UPLOADS = 2
const MAX_SERVER_RETRIES = 3
const MAX_SLOWDOWN_WAITS = 5

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
const fileKey = (f: FoundFile) => `${f.path}|${f.file.size}|${f.file.lastModified}`
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

type Props = {
  /** Called when the server says the session has ended */
  onSessionExpired: () => void
}

function UploadPage({ onSessionExpired }: Props) {
  const collections = useCollections()
  const [chosenCollection, setChosenCollection] = useState(() => {
    try {
      return localStorage.getItem('upload-collection') ?? ''
    } catch {
      return ''
    }
  })
  const collectionId = collections?.some((c) => c.id === chosenCollection) ? chosenCollection : (collections?.[0]?.id ?? '')
  const collection = collections?.find((c) => c.id === collectionId)

  const [items, setItems] = useState<Item[]>([])
  const [caption, setCaption] = useState('')
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  // Non-image files seen so far, so adding the same folder twice doesn't count them twice
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(() => new Set())
  const skipped = skippedKeys.size

  // The upload workers read and write the list outside React's render cycle, so keep a live copy
  const itemsRef = useRef<Item[]>([])
  const stopRef = useRef<AbortController | null>(null)
  const filesInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  function commit(next: Item[]) {
    itemsRef.current = next
    setItems(next)
  }

  function update(id: string, patch: Partial<Item>) {
    commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  useEffect(() => {
    try {
      if (collectionId) localStorage.setItem('upload-collection', collectionId)
    } catch {
      // Storage unavailable; the choice just won't be remembered
    }
  }, [collectionId])

  // Folder picking isn't a standard attribute, so React won't set it
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  // Release previews and stop uploads when leaving the page
  useEffect(
    () => () => {
      stopRef.current?.abort()
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.preview))
    },
    [],
  )

  // Warn before closing the tab mid-upload
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  function addFiles({ images, ignored }: Found) {
    const known = new Set(itemsRef.current.map((item) => fileKey(item)))
    const fresh = images.filter((f) => !known.has(fileKey(f)))
    const duplicates = images.length - fresh.length
    commit([
      ...itemsRef.current,
      ...fresh.map((f) => ({
        id: crypto.randomUUID(),
        file: f.file,
        path: f.path,
        preview: URL.createObjectURL(f.file),
        status: 'queued' as const,
        progress: 0,
      })),
    ])
    setSkippedKeys((prev) => new Set([...prev, ...ignored.map(fileKey)]))
    const parts = [`Added ${fresh.length} photo${fresh.length === 1 ? '' : 's'}`]
    if (duplicates) parts.push(`${duplicates} already in the list`)
    if (ignored.length) parts.push(`${ignored.length} non-image file${ignored.length === 1 ? '' : 's'} skipped`)
    setNotice(parts.join(' · '))
  }

  function removeItems(keep: (item: Item) => boolean) {
    itemsRef.current.filter((item) => !keep(item)).forEach((item) => URL.revokeObjectURL(item.preview))
    commit(itemsRef.current.filter(keep))
  }

  async function uploadOne(item: Item, signal: AbortSignal) {
    update(item.id, { status: 'uploading', progress: 0, error: undefined })
    let image: Blob
    try {
      image = await prepareImage(item.file)
    } catch (err) {
      update(item.id, { status: 'failed', error: err instanceof Error ? err.message : "Couldn't read this photo." })
      return
    }
    const filename = `${item.file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`

    let serverRetries = 0
    let slowdowns = 0
    while (!signal.aborted) {
      let res
      try {
        res = await sendPhoto(collectionId, image, filename, { caption: caption.trim().slice(0, 200) }, (p) => update(item.id, { progress: p }), signal)
      } catch (err) {
        if (signal.aborted) break
        update(item.id, { status: 'failed', error: err instanceof Error ? err.message : 'Upload failed.' })
        return
      }

      if (res.status >= 200 && res.status < 300) {
        update(item.id, { status: 'done', progress: 1, link: res.body.photo?.short_url })
        return
      }
      if (res.status === 401 && res.body.error === 'Locked') {
        stopRef.current?.abort()
        update(item.id, { status: 'queued', progress: 0 })
        setNotice('Your session ended. Unlock again, then press Upload to carry on.')
        onSessionExpired()
        return
      }
      if (res.status === 429 && slowdowns < MAX_SLOWDOWN_WAITS) {
        slowdowns++
        const seconds = res.retryAfter ?? 30
        setNotice(`RankUOG asked us to slow down. Carrying on in ${seconds} seconds…`)
        update(item.id, { progress: 0 })
        await wait(seconds * 1000, signal)
        setNotice('')
        continue
      }
      if (res.status >= 500 && serverRetries < MAX_SERVER_RETRIES) {
        serverRetries++
        await wait(serverRetries * 1500, signal)
        continue
      }
      update(item.id, { status: 'failed', error: res.body.error ?? `Upload failed (HTTP ${res.status}).` })
      return
    }
    // Stopped part-way: put it back in the queue
    update(item.id, { status: 'queued', progress: 0 })
  }

  async function startUpload() {
    if (!collectionId || running) return
    const controller = new AbortController()
    stopRef.current = controller
    setRunning(true)
    setNotice('')

    // Each worker takes the next queued photo until none are left, so photos added mid-way get picked up too
    const claimed = new Set<string>()
    const worker = async () => {
      while (!controller.signal.aborted) {
        const next = itemsRef.current.find((item) => item.status === 'queued' && !claimed.has(item.id))
        if (!next) return
        claimed.add(next.id)
        await uploadOne(next, controller.signal)
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker))

    setRunning(false)
    stopRef.current = null
    const failedCount = itemsRef.current.filter((item) => item.status === 'failed').length
    if (!controller.signal.aborted) {
      setNotice(failedCount ? `Finished with ${failedCount} failed. You can retry them below.` : 'All photos uploaded.')
    }
  }

  function stopUpload() {
    stopRef.current?.abort()
    setNotice('Stopped. Photos not yet uploaded are still in the list.')
  }

  async function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    setDragging(false)
    addFiles(await filesFromDrop(e.dataTransfer))
  }

  const counts = {
    total: items.length,
    queued: items.filter((i) => i.status === 'queued').length,
    uploading: items.filter((i) => i.status === 'uploading').length,
    done: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'failed').length,
  }
  const progressSum = items.reduce((sum, i) => sum + (i.status === 'done' ? 1 : i.status === 'uploading' ? i.progress : 0), 0)
  const overall = counts.total ? progressSum / counts.total : 0
  const noCollections = collections?.length === 0

  return (
    <div className="upload-page">
      <header className="upload-header">
        <h1>Upload photos</h1>
        <p>Send a batch of photos, or whole folders, to one of your RankUOG collections.</p>
      </header>

      <section className="upload-card">
        <div className="upload-collection">
          <label className="upload-field">
            <span>Collection</span>
            <Select
              value={collectionId}
              onChange={(e) => setChosenCollection(e.target.value)}
              disabled={running || !collections?.length}
            >
              {collections === null && <option value="">Loading…</option>}
              {noCollections && <option value="">No collections yet</option>}
              {collections?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
          {collection?.url && (
            <a className="upload-link" href={collection.url} target="_blank" rel="noreferrer">
              View collection <LuExternalLink aria-hidden="true" />
              <span className="visually-hidden">(opens in a new tab)</span>
            </a>
          )}
        </div>
        {noCollections && (
          <p className="upload-hint">
            Add a collection key in <a href="/admin/settings">Settings</a> first.
          </p>
        )}

        <div
          className={`upload-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
          }}
          onDrop={handleDrop}
        >
          <LuCloudUpload className="upload-drop-icon" aria-hidden="true" />
          <p className="upload-drop-title">Drag photos or folders here</p>
          <p className="upload-hint">Folders are searched all the way down. Files that aren't photos are skipped.</p>
          <div className="upload-drop-actions">
            <button type="button" className="upload-button" onClick={() => filesInputRef.current?.click()}>
              <LuImages aria-hidden="true" /> Choose photos
            </button>
            <button type="button" className="upload-button" onClick={() => folderInputRef.current?.click()}>
              <LuFolderOpen aria-hidden="true" /> Choose folder
            </button>
          </div>
          <input
            ref={filesInputRef}
            type="file"
            accept={PHOTO_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(filesFromInput(e.target.files))
              e.target.value = ''
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(filesFromInput(e.target.files))
              e.target.value = ''
            }}
          />
        </div>

        <label className="upload-field">
          <span>
            Caption <span className="upload-optional">optional, added to every photo in this batch</span>
          </span>
          <input type="text" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={running} />
        </label>
      </section>

      {items.length > 0 && (
        <section className="upload-card" aria-labelledby="upload-queue-title">
          <div className="upload-queue-head">
            <h2 id="upload-queue-title">
              {counts.total} photo{counts.total === 1 ? '' : 's'}
            </h2>
            <p className="upload-counts">
              {counts.done} uploaded
              {counts.uploading > 0 && ` · ${counts.uploading} uploading`}
              {counts.queued > 0 && ` · ${counts.queued} waiting`}
              {counts.failed > 0 && <span className="upload-failed-count"> · {counts.failed} failed</span>}
              {skipped > 0 && ` · ${skipped} skipped`}
            </p>
          </div>
          <div
            className="upload-progress"
            role="progressbar"
            aria-label="Overall progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overall * 100)}
          >
            <span style={{ width: `${overall * 100}%` }} />
          </div>

          <div className="upload-actions">
            {running ? (
              <button type="button" className="upload-button" onClick={stopUpload}>
                <LuSquare aria-hidden="true" /> Stop
              </button>
            ) : (
              counts.queued > 0 && (
                <button type="button" className="upload-button primary" onClick={startUpload} disabled={!collectionId}>
                  <LuCloudUpload aria-hidden="true" /> Upload {counts.queued} photo{counts.queued === 1 ? '' : 's'}
                </button>
              )
            )}
            {counts.failed > 0 && !running && (
              <button
                type="button"
                className="upload-button"
                onClick={() => commit(itemsRef.current.map((i) => (i.status === 'failed' ? { ...i, status: 'queued', error: undefined } : i)))}
              >
                <LuRotateCw aria-hidden="true" /> Retry {counts.failed} failed
              </button>
            )}
            {counts.done > 0 && (
              <button type="button" className="upload-button" onClick={() => removeItems((i) => i.status !== 'done')}>
                Clear uploaded
              </button>
            )}
            {!running && (
              <button
                type="button"
                className="upload-button subtle"
                onClick={() => {
                  removeItems(() => false)
                  setSkippedKeys(new Set())
                  setNotice('')
                }}
              >
                Clear all
              </button>
            )}
          </div>
          {notice && (
            <p className="upload-notice" role="status">
              {notice}
            </p>
          )}

          <ul className="upload-list">
            {items.map((item) => (
              <li key={item.id} className={`upload-item ${item.status}${looksLikeHeic(item.file) ? ' heic' : ''}`}>
                <img
                  src={item.preview}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  // Files the browser can't show (like HEIC) get a plain tile instead of a broken image
                  onError={(e) => e.currentTarget.classList.add('no-preview')}
                />
                <div className="upload-item-info">
                  <span className="upload-item-name" title={item.path}>
                    {item.path}
                  </span>
                  {item.status === 'uploading' && (
                    <span className="upload-item-bar">
                      <span style={{ width: `${Math.max(4, item.progress * 100)}%` }} />
                    </span>
                  )}
                  {item.status === 'failed' && <span className="upload-item-error">{item.error}</span>}
                  {item.status === 'done' && item.link && (
                    <a className="upload-item-link" href={item.link} target="_blank" rel="noreferrer">
                      {item.link.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {item.status === 'queued' && <span className="upload-item-meta">{formatSize(item.file.size)} · waiting</span>}
                </div>
                <span className="upload-item-status">
                  {item.status === 'uploading' && <LuLoaderCircle className="spin" aria-label="Uploading" />}
                  {item.status === 'done' && <LuCircleCheck aria-label="Uploaded" />}
                  {item.status === 'failed' && <LuCircleAlert aria-label="Failed" />}
                </span>
                {(item.status === 'queued' || item.status === 'failed') && !running && (
                  <button
                    type="button"
                    className="upload-item-remove"
                    onClick={() => removeItems((i) => i.id !== item.id)}
                    aria-label={`Remove ${item.path}`}
                    title="Remove"
                  >
                    <LuX aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default UploadPage

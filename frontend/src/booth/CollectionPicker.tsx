import { useEffect, useRef, useState } from 'react'
import { LuRefreshCw, LuX } from 'react-icons/lu'
import { Select } from '../Select.tsx'
import { formatSetDate, formatSetTime, setSearchText, useCollectionSets } from '../collectionSets.ts'
import type { CollectionOption, CollectionPhoto } from '../rankuogClient.ts'
import { readStorage, writeStorage } from './storage.ts'
import './picker.css'

type Props = {
  collections: CollectionOption[] | null
  /** How many photos can be chosen at once */
  max: number
  /** Loads the chosen photos into the Booth; the picker closes once it resolves */
  onChoose: (photos: CollectionPhoto[]) => Promise<void>
  onClose: () => void
  onSessionExpired: () => void
}

/** A modal for picking photos that are already in a collection, one by one or a whole set at once */
function CollectionPicker({ collections, max, onChoose, onClose, onSessionExpired }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [chosenCollection, setChosenCollection] = useState(() => readStorage('picker-collection') ?? readStorage('booth-collection') ?? '')
  const collection = collections?.find((c) => c.id === chosenCollection) ?? collections?.[0]
  const collectionId = collection?.id ?? ''
  const { sets, hasLoaded, loading, error, refresh } = useCollectionSets(collectionId, onSessionExpired)
  const [filter, setFilter] = useState('')
  // Chosen photos, in the order they'll fill the boxes
  const [picked, setPicked] = useState<CollectionPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  // Shown as a modal from the moment it's on the page
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    if (collectionId) writeStorage('picker-collection', collectionId)
  }, [collectionId])

  const query = filter.trim().toLowerCase()
  const shown = query ? sets.filter((s) => setSearchText(s).includes(query)) : sets
  const fallbackTitle = collection?.label ?? 'Photos'

  function toggle(photo: CollectionPhoto) {
    setNotice('')
    if (picked.some((p) => p.id === photo.id)) setPicked(picked.filter((p) => p.id !== photo.id))
    else if (picked.length < max) setPicked([...picked, photo])
    else setNotice(`Up to ${max} photos at a time. Take one off first.`)
  }

  async function choose(photos: CollectionPhoto[]) {
    if (!photos.length || busy) return
    setBusy(true)
    setNotice(`Loading ${photos.length} photo${photos.length === 1 ? '' : 's'}…`)
    try {
      await onChoose(photos)
      onClose()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't load the photos.")
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="picker"
      aria-labelledby="picker-title"
      // Escape closes the dialog by itself; keep React in step, but not while photos are loading
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      <header className="picker-header">
        <h2 id="picker-title">Choose from a collection</h2>
        <button type="button" className="picker-icon-button" onClick={onClose} disabled={busy} aria-label="Close">
          <LuX aria-hidden="true" />
        </button>
      </header>

      <div className="picker-toolbar">
        <Select
          value={collectionId}
          onChange={(e) => {
            setChosenCollection(e.target.value)
            setPicked([])
            setNotice('')
          }}
          disabled={!collections?.length || busy}
          aria-label="Collection"
        >
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
          className="picker-icon-button"
          onClick={refresh}
          disabled={!collectionId || loading}
          aria-label="Refresh"
          title="Load the latest photos"
        >
          <LuRefreshCw aria-hidden="true" className={loading ? 'picker-spin' : undefined} />
        </button>
        <input type="search" placeholder="Search by title or time" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search" />
      </div>

      <div className="picker-body">
        {collections?.length === 0 ? (
          <p className="picker-message">
            Add a collection key in <a href="/admin/settings">Settings</a> first.
          </p>
        ) : error ? (
          <p className="picker-message error" role="alert">
            {error}
          </p>
        ) : !hasLoaded ? (
          <p className="picker-message">Loading photos…</p>
        ) : sets.length === 0 ? (
          <p className="picker-message">No photos in this collection yet.</p>
        ) : shown.length === 0 ? (
          <p className="picker-message">Nothing matches “{filter.trim()}”.</p>
        ) : (
          shown.map((set) => (
            <section key={set.key} className="picker-set" aria-label={set.title || fallbackTitle}>
              <div className="picker-set-header">
                <div>
                  <div className="picker-set-title">{set.title || fallbackTitle}</div>
                  <div className="picker-set-meta">
                    {formatSetDate(set.created)} · {formatSetTime(set.created)} · {set.photos.length} photo{set.photos.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button type="button" className="booth-button" onClick={() => choose(set.photos.slice(0, max))} disabled={busy}>
                  {set.photos.length > max ? `Use first ${max}` : set.photos.length === 1 ? 'Use photo' : 'Use set'}
                </button>
              </div>
              <ul className="picker-photos">
                {set.photos.map((photo) => {
                  const order = picked.findIndex((p) => p.id === photo.id)
                  return (
                    <li key={photo.id}>
                      <button
                        type="button"
                        className="picker-photo"
                        aria-pressed={order >= 0}
                        onClick={() => toggle(photo)}
                        disabled={busy}
                        aria-label={order >= 0 ? `Photo, chosen as number ${order + 1}` : 'Photo'}
                      >
                        <img src={photo.url} alt="" loading="lazy" decoding="async" />
                        {order >= 0 && <span className="picker-photo-order">{order + 1}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <footer className="picker-footer">
        <p className="picker-status" role="status">
          {notice || (picked.length ? `${picked.length} of ${max} chosen` : 'Tap photos to choose them, or use a whole set.')}
        </p>
        <div className="picker-actions">
          {picked.length > 0 && (
            <button type="button" className="booth-button" onClick={() => setPicked([])} disabled={busy}>
              Clear
            </button>
          )}
          <button type="button" className="booth-button primary" onClick={() => choose(picked)} disabled={busy || picked.length === 0}>
            {busy ? 'Loading…' : picked.length ? `Add ${picked.length} photo${picked.length === 1 ? '' : 's'}` : 'Add photos'}
          </button>
        </div>
      </footer>
    </dialog>
  )
}

export default CollectionPicker

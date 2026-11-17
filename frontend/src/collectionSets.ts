import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCollectionPhotos, SessionEndedError, type CollectionPhoto } from './rankuogClient.ts'

// A collection's photos, grouped the way they were uploaded. Used by the QR codes page and the Booth's photo picker.

/** Photos uploaded together (one Booth session), or a single photo uploaded on its own */
export type PhotoSet = {
  key: string
  /** Empty when the photos had no caption; the collection's name stands in */
  title: string
  created: string
  photos: CollectionPhoto[]
}

// The Booth names a strip "<title> YYYY-MM-DD HH:MM:SS"; the title alone is the caption
const STRIP_STAMP = / \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** Groups photos into sets, newest set first, each set's photos in upload order */
export function groupPhotos(photos: CollectionPhoto[]): PhotoSet[] {
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

export const formatSetDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const formatSetTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Text a search box can match a set against */
export const setSearchText = (set: PhotoSet) => `${set.title} ${formatSetDate(set.created)} ${formatSetTime(set.created)}`.toLowerCase()

/**
 * Loads a collection's photo sets, again whenever `refresh` is called. Sets from an earlier
 * collection are never shown for a new one; a refresh keeps the current list up while it loads.
 */
export function useCollectionSets(collectionId: string, onSessionExpired: () => void) {
  const [loaded, setLoaded] = useState<{ collectionId: string; photos: CollectionPhoto[] } | null>(null)
  // Which load last finished, and how
  const [status, setStatus] = useState<{ key: string; error: string } | null>(null)
  const [reload, setReload] = useState(0)
  const key = `${collectionId}|${reload}`

  useEffect(() => {
    if (!collectionId) return
    const controller = new AbortController()
    const thisKey = `${collectionId}|${reload}`
    fetchCollectionPhotos(collectionId, controller.signal).then(
      (photos) => {
        setLoaded({ collectionId, photos })
        setStatus({ key: thisKey, error: '' })
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof SessionEndedError) onSessionExpired()
        setStatus({ key: thisKey, error: err instanceof Error ? err.message : "Couldn't load the photos." })
      },
    )
    return () => controller.abort()
  }, [collectionId, reload, onSessionExpired])

  const current = loaded?.collectionId === collectionId ? loaded.photos : null
  const sets = useMemo(() => (current ? groupPhotos(current) : []), [current])
  const refresh = useCallback(() => setReload((n) => n + 1), [])

  return {
    sets,
    /** False until the first load for this collection finishes */
    hasLoaded: current !== null,
    loading: Boolean(collectionId) && status?.key !== key,
    error: status?.key === key ? status.error : '',
    refresh,
  }
}

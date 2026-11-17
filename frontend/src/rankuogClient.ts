import { useEffect, useState } from 'react'

// Browser side of the RankUOG proxy. The server adds the collection's key, so none of this sees one.

export type CollectionOption = { id: string; label: string; title: string; url: string }

export const apiBase = (collectionId: string) => `/api/rankuog/${encodeURIComponent(collectionId)}`

/** The collections saved in Settings; null while loading */
export function useCollections(): CollectionOption[] | null {
  const [collections, setCollections] = useState<CollectionOption[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<{ collections: CollectionOption[] }>) : { collections: [] }))
      .catch(() => ({ collections: [] as CollectionOption[] }))
      .then(({ collections: list }) => !cancelled && setCollections(list))
    return () => {
      cancelled = true
    }
  }, [])
  return collections
}

// The API takes up to 10 MB and recommends about 2560 px on the long side;
// stay well under the limit in case a photo is unusually detailed.
const MAX_BYTES = 8 * 1024 * 1024
const SIDES = [2560, 2048, 1600]
const QUALITIES = [0.9, 0.8, 0.7]

// iPhone photos. Their type is often missing (on Windows especially), so the extension counts too.
const HEIC_EXTENSION = /\.hei[cf]$/i
export const looksLikeHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || HEIC_EXTENSION.test(file.name)

/** Anything that might be a photo, including HEIC files the system didn't give an image type */
export const isPhotoFile = (file: File) => file.type.startsWith('image/') || looksLikeHeic(file)

/** For file pickers: image/* alone doesn't let HEIC files be chosen on every system */
export const PHOTO_ACCEPT = 'image/*,.heic,.heif'

// The HEIC decoder is a few MB, so it's only downloaded the first time a HEIC photo turns up
const loadHeicDecoder = () => import('heic-to')

/** Opens a photo for drawing. HEIC is converted when the browser can't read it itself (Safari can; Chrome can't). */
async function decodePhoto(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    if (!looksLikeHeic(file)) throw new Error("This browser can't read this file. RAW photos need converting to JPEG first.")
  }
  try {
    const { heicTo } = await loadHeicDecoder()
    return await heicTo({ blob: file, type: 'bitmap' })
  } catch {
    throw new Error("Couldn't convert this HEIC photo. Try exporting it as JPEG.")
  }
}

/**
 * A version of the photo the page can show in an <img>. Only HEIC needs work: it becomes a JPEG,
 * unless the browser can already show it.
 */
export async function displayablePhoto(file: File): Promise<File> {
  if (!looksLikeHeic(file)) return file
  try {
    ;(await createImageBitmap(file)).close()
    return file
  } catch {
    // Not readable here, so convert it
  }
  const { heicTo } = await loadHeicDecoder()
  const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
  return new File([jpeg], file.name.replace(HEIC_EXTENSION, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified })
}

/** Re-encodes a photo as JPEG under the upload limit: lower the quality first, then the size if needed */
export async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await decodePhoto(file)
  try {
    let blob: Blob | null = null
    for (const side of SIDES) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITIES) {
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (!blob) throw new Error("Couldn't read this photo.")
        if (blob.size <= MAX_BYTES) return blob
      }
    }
    if (!blob) throw new Error("Couldn't read this photo.")
    return blob
  } finally {
    bitmap.close()
  }
}

export type PhotoResponse = {
  status: number
  body: { photo?: { id: string; short_url?: string }; qr_svg?: string; qr_png?: string; error?: string }
  /** Seconds to wait, when the server says to slow down */
  retryAfter: number | null
}

/**
 * Sends one photo. Uses XMLHttpRequest rather than fetch because only it reports upload progress.
 * Rejects only when the server can't be reached or the upload is stopped; HTTP errors resolve.
 */
export function sendPhoto(
  collectionId: string,
  image: Blob,
  filename: string,
  fields: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<PhotoResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', image, filename)
    for (const [name, value] of Object.entries(fields)) if (value) form.append(name, value)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiBase(collectionId)}/photos`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let body: PhotoResponse['body'] = {}
      try {
        body = JSON.parse(xhr.responseText) as PhotoResponse['body']
      } catch {
        // Not JSON; leave the body empty and let the status speak
      }
      const wait = Number(xhr.getResponseHeader('Retry-After'))
      resolve({ status: xhr.status, body, retryAfter: Number.isFinite(wait) && wait > 0 ? wait : null })
    }
    xhr.onerror = () => reject(new Error("Couldn't reach the server."))
    xhr.onabort = () => reject(new DOMException('Stopped', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

/** A photo already in a collection. Photos uploaded together from the Booth share a `strip` name. */
export type CollectionPhoto = {
  id: string
  url: string
  short_url?: string
  strip?: string | null
  caption?: string | null
  created_at: string
}

/** Thrown when the server says the PIN session has ended */
export class SessionEndedError extends Error {}

/** Every photo in a collection, as RankUOG lists them */
export async function fetchCollectionPhotos(collectionId: string, signal?: AbortSignal): Promise<CollectionPhoto[]> {
  let res: Response
  try {
    res = await fetch(`${apiBase(collectionId)}/photos`, { credentials: 'same-origin', signal })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error("Couldn't reach the server. Check your connection and try again.")
  }
  const body = (await res.json().catch(() => ({}))) as { photos?: unknown; error?: string }
  if (res.status === 401 && body.error === 'Locked') throw new SessionEndedError('Your session ended.')
  if (!res.ok) throw new Error(`Couldn't load the photos (HTTP ${res.status}): ${body.error ?? 'no details'}.`)
  if (!Array.isArray(body.photos)) return []
  return body.photos.filter(
    (p): p is CollectionPhoto => typeof p?.id === 'string' && typeof p.url === 'string' && typeof p.created_at === 'string',
  )
}

/** Downloads a photo from a collection, so the Booth can use it like one chosen from this computer */
export async function downloadCollectionPhoto(photo: CollectionPhoto): Promise<File> {
  let res: Response
  try {
    res = await fetch(photo.url)
  } catch {
    throw new Error("Couldn't download the photos. Check your connection and try again.")
  }
  if (!res.ok) throw new Error(`Couldn't download a photo (HTTP ${res.status}).`)
  const blob = await res.blob()
  const type = blob.type.startsWith('image/') ? blob.type : 'image/jpeg'
  return new File([blob], `${photo.id}.${type.split('/')[1] ?? 'jpg'}`, { type })
}

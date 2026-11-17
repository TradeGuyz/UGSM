import { apiBase, prepareImage } from '../rankuogClient.ts'

export type UploadResult = {
  photo: { id: string; short_url?: string }
  qr_svg?: string
  qr_png?: string
}

/** Upload progress for the current photo set, so a retry skips photos that already went up */
export type UploadState = { collectionId: string; strip: string; results: UploadResult[] }

// Shown as an <img> rather than inserted markup, so nothing from the API runs in the page
// `attempt` changes the address on each retry, so a QR code that failed to load is fetched again
export function qrSrc(result: UploadResult, collectionId: string, attempt = 0): string {
  if (result.qr_svg) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.qr_svg)}`
  if (result.qr_png) return result.qr_png.startsWith('data:') ? result.qr_png : `data:image/png;base64,${result.qr_png}`
  const retry = attempt ? `&attempt=${attempt}` : ''
  return `${apiBase(collectionId)}/photos/${encodeURIComponent(result.photo.id)}/qr.png?size=1000${retry}`
}

// The API allows at most 64 characters for the strip name, so trim the title rather than the timestamp
export function stripLabel(title: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = ` ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return title.slice(0, 64 - stamp.length) + stamp
}

/**
 * Uploads the photos as one strip to the chosen collection. Results are added to `state` as each
 * photo succeeds, so calling again after an error carries on without creating duplicates.
 */
export async function uploadPhotos(
  state: UploadState,
  files: File[],
  caption: string,
  onProgress: (message: string) => void,
): Promise<void> {
  for (let i = state.results.length; i < files.length; i++) {
    onProgress(`Uploading photo ${i + 1} of ${files.length}…`)
    const image = await prepareImage(files[i])
    const form = new FormData()
    form.append('file', image, `photo-${i + 1}.jpg`)
    form.append('caption', caption.slice(0, 200))
    form.append('strip', state.strip)

    // Server errors (5xx) are often one-off, so retry a couple of times before giving up
    let res: Response | undefined
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(`${apiBase(state.collectionId)}/photos`, { method: 'POST', body: form, credentials: 'same-origin' })
      } catch {
        throw new Error("Couldn't reach the server. Check your connection and try again.")
      }
      if (res.status < 500 || attempt === 3) break
      onProgress(`Uploading photo ${i + 1} of ${files.length}… (retrying)`)
      await new Promise((r) => setTimeout(r, attempt * 1500))
    }
    if (!res) throw new Error('Upload failed.')

    const body = (await res.json().catch(() => ({}))) as Partial<UploadResult> & { error?: string }
    if (res.status === 401 && body.error === 'Locked') throw new Error('Your session ended. Unlock again, then print.')
    if (res.status === 429) {
      const wait = res.headers.get('Retry-After')
      throw new Error(`Upload limit reached. Try again in ${wait ? `${wait} seconds` : 'a little while'}.`)
    }
    if (!res.ok || !body.photo?.id) {
      const size = `${(image.size / 1024 / 1024).toFixed(1)} MB`
      throw new Error(`Upload of photo ${i + 1} failed (HTTP ${res.status}, ${size}): ${body.error ?? 'no details'}.`)
    }
    state.results.push(body as UploadResult)
  }
}

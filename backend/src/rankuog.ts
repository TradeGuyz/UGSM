// RANKUOG_API_URL points the server at a stand-in API, e.g. a local mock for testing uploads
export const RANKUOG_API = process.env.RANKUOG_API_URL || 'https://nccumhlfkzdvitvrzvjv.supabase.co/functions/v1/collection-api'

export type LookupResult =
  | { ok: true; collectionId: string; title: string; url: string }
  | { ok: false; message: string }

// Each RankUOG key belongs to one collection; asking for its photos tells us which one
export async function lookupCollection(key: string): Promise<LookupResult> {
  let res: Response
  try {
    res = await fetch(`${RANKUOG_API}/photos`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { ok: false, message: "Couldn't reach RankUOG. Check your connection and try again." }
  }

  if (res.status === 401 || res.status === 403) return { ok: false, message: 'RankUOG rejected this key.' }
  if (!res.ok) return { ok: false, message: `RankUOG returned an error (${res.status}). Try again later.` }

  const body = (await res.json().catch(() => null)) as { collection?: { id?: string; title?: string; url?: string } } | null
  const collection = body?.collection
  if (!collection?.id) return { ok: false, message: "RankUOG's reply didn't say which collection this key is for." }

  return { ok: true, collectionId: collection.id, title: collection.title || 'Untitled collection', url: collection.url ?? '' }
}

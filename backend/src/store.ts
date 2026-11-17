import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Collection = {
  /** Our id, used in /api/rankuog/<id>/... */
  id: string
  label: string
  key: string
  /** RankUOG's id for the collection the key belongs to */
  collectionId: string
  title: string
  url: string
  addedAt: string
}

type StoredPin = { salt: string; hash: string; updatedAt: string }
type Data = { pin?: StoredPin; collections: Collection[] }

export type PinSource = 'settings' | 'env' | 'none'
export type Store = ReturnType<typeof createStore>

function scrypt(pin: string, salt: string): Buffer {
  return scryptSync(pin, salt, 32)
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Settings saved as JSON on the server. Holds the PIN (salted scrypt hash, never the PIN itself)
 * and the RankUOG collection keys, which have to be stored as-is so the server can use them.
 * Until a PIN is set here, APP_PIN from the environment is used.
 */
export function createStore(file: string, envPin: string | undefined) {
  const exists = existsSync(file)
  let data: Data = { collections: [] }
  if (exists) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8')) as Data
      data.collections ??= []
    } catch (err) {
      throw new Error(`Couldn't read the settings file at ${file}. Fix or delete it, then restart.`, { cause: err })
    }
  }

  function save() {
    mkdirSync(dirname(file), { recursive: true })
    // Write then rename, so a crash mid-write can't leave a half-written file
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }

  return {
    /** True until the settings file has been written for the first time */
    isNew: !exists,

    pinSource(): PinSource {
      if (data.pin) return 'settings'
      return envPin ? 'env' : 'none'
    },

    verifyPin(pin: string): boolean {
      if (data.pin) return timingSafeEqual(scrypt(pin, data.pin.salt), Buffer.from(data.pin.hash, 'base64'))
      if (envPin) return timingSafeEqual(sha256(pin), sha256(envPin))
      return false
    },

    setPin(pin: string) {
      const salt = randomBytes(16).toString('base64')
      data.pin = { salt, hash: scrypt(pin, salt).toString('base64'), updatedAt: new Date().toISOString() }
      save()
    },

    listCollections(): readonly Collection[] {
      return data.collections
    },

    getCollection(id: string): Collection | undefined {
      return data.collections.find((c) => c.id === id)
    },

    findByCollectionId(collectionId: string): Collection | undefined {
      return data.collections.find((c) => c.collectionId === collectionId)
    },

    addCollection(fields: Omit<Collection, 'id' | 'addedAt'>): Collection {
      const collection = { ...fields, id: randomUUID(), addedAt: new Date().toISOString() }
      data.collections.push(collection)
      save()
      return collection
    },

    removeCollection(id: string): boolean {
      const before = data.collections.length
      data.collections = data.collections.filter((c) => c.id !== id)
      if (data.collections.length === before) return false
      save()
      return true
    },
  }
}

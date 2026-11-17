export type FoundFile = { file: File; path: string }
export type Found = { images: FoundFile[]; ignored: FoundFile[] }

// Some photos (HEIC from iPhones, for example) arrive without a type, so check the extension too
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
}

// .DS_Store, ._IMG_0001.jpg and the like are system files, not photos
const isHidden = (name: string) => name.startsWith('.')

function sort(found: FoundFile[]): Found {
  const visible = found.filter((f) => !isHidden(f.file.name))
  const images = visible.filter((f) => isImage(f.file)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  return { images, ignored: visible.filter((f) => !isImage(f.file)) }
}

/** Files from a file picker; from a folder picker, each keeps its path inside the folder */
export function filesFromInput(list: FileList | null): Found {
  return sort(Array.from(list ?? [], (file) => ({ file, path: file.webkitRelativePath || file.name })))
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: FoundFile[]) {
  if (entry.isFile) {
    out.push({ file: await readFile(entry as FileSystemFileEntry), path: entry.fullPath.replace(/^\//, '') })
    return
  }
  if (entry.isDirectory && !isHidden(entry.name)) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // Directories hand back their contents in batches (about 100 at a time in Chrome) until one comes back empty
    for (;;) {
      const batch = await readBatch(reader)
      if (!batch.length) break
      for (const child of batch) await walk(child, out)
    }
  }
}

/** Files and folders dropped on the page, with folders searched all the way down */
export async function filesFromDrop(data: DataTransfer): Promise<Found> {
  // Entries have to be collected right away, while the drop event is still being handled
  const entries = Array.from(data.items, (item) => item.webkitGetAsEntry()).filter((e): e is FileSystemEntry => e !== null)
  if (!entries.length) return sort(Array.from(data.files, (file) => ({ file, path: file.name })))
  const out: FoundFile[] = []
  for (const entry of entries) await walk(entry, out)
  return sort(out)
}

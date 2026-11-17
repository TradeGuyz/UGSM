import { useEffect, useRef, useState } from 'react'
import './PhotoUpload.css'

type Photo = {
  id: string
  file: File
  url: string
}

function PhotoUpload() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const photosRef = useRef(photos)

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  // Release object URLs when the component unmounts
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  function addFiles(files: FileList | null) {
    if (!files) return
    const added = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))
    setPhotos((prev) => [...prev, ...added])
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id)
      if (photo) URL.revokeObjectURL(photo.url)
      return prev.filter((p) => p.id !== id)
    })
  }

  return (
    <section className="photo-upload">
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
      >
        <p>Drag photos here, or click to choose</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {photos.length > 0 && (
        <ul className="photo-grid">
          {photos.map((photo) => (
            <li key={photo.id}>
              <img src={photo.url} alt={photo.file.name} />
              <button type="button" aria-label={`Remove ${photo.file.name}`} onClick={() => removePhoto(photo.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default PhotoUpload

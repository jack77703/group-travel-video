'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getSession, Session } from '@/lib/session'

async function toJpeg(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const MAX = 3840
      let { naturalWidth: w, naturalHeight: h } = img
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX }
        else { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })),
        'image/jpeg',
        0.92
      )
    }
    img.src = objectUrl
  })
}

export default function UploadPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [session, setSessionState] = useState<Session | null>(null)
  const [maxPhotos, setMaxPhotos] = useState(5)
  const [photos, setPhotos] = useState<File[]>([])
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [failedIndex, setFailedIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceIndexRef = useRef<number>(-1)
  const previewUrls = useRef<Map<File, string>>(new Map())

  function getPreviewUrl(file: File): string {
    if (!previewUrls.current.has(file)) {
      previewUrls.current.set(file, URL.createObjectURL(file))
    }
    return previewUrls.current.get(file)!
  }

  useEffect(() => {
    return () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    const storedSession = getSession(code)
    if (!storedSession) {
      router.replace(`/room/${code}`)
      return
    }
    setSessionState(storedSession)
    fetch(`/api/rooms/${code}`)
      .then((r) => r.json())
      .then((data) => setMaxPhotos(data.max_photos_per_member))
      .catch(() => setError('Could not load room details'))
  }, [code, router])

  async function handleAddFiles(files: FileList | null) {
    if (!files) return
    const slotsLeft = maxPhotos - photos.length
    const incoming = await Promise.all(
      Array.from(files)
        .filter((f) => f.type.startsWith('image/'))
        .slice(0, slotsLeft)
        .map(toJpeg)
    )
    setPhotos((prev) => [...prev, ...incoming])
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  function openReplace(index: number) {
    replaceIndexRef.current = index
    replaceInputRef.current?.click()
  }

  async function handleReplaceFile(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!file.type.startsWith('image/')) return
    const compressed = await toJpeg(file)
    const idx = replaceIndexRef.current
    setPhotos((prev) => {
      const next = [...prev]
      next[idx] = compressed
      return next
    })
    if (replaceInputRef.current) replaceInputRef.current.value = ''
  }

  async function handleReady() {
    if (!session || photos.length !== maxPhotos) return
    setUploading(true)
    setError('')
    setFailedIndex(null)

    for (let i = 0; i < photos.length; i++) {
      const file = photos[i]
      setUploadingIndex(i)
      try {
        const res = await fetch(`/api/rooms/${code}/photos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': session.token,
          },
          body: JSON.stringify({ file_name: file.name, file_type: file.type }),
        })
        const data = await res.json()

        if (!res.ok || !data.upload_url) throw new Error(data.error ?? 'Could not create upload URL')

        const uploadRes = await fetch(data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!uploadRes.ok) throw new Error('Upload failed')
      } catch (err) {
        setFailedIndex(i)
        setError(err instanceof Error ? err.message : 'Upload failed')
        setUploading(false)
        setUploadingIndex(null)
        return
      }
    }

    setUploadingIndex(null)
    setUploading(false)
    router.push(`/room/${code}/lobby`)
  }

  const atCap = photos.length >= maxPhotos
  const readyToUpload = photos.length === maxPhotos && !uploading

  return (
    <main className="flex h-dvh flex-col bg-black px-6 py-8 text-white">
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        {/* Header — fixed */}
        <div className="flex-shrink-0 mb-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 transition hover:border-white/30 hover:text-white/80"
          >
            ← Home
          </button>
        </div>
        <div className="flex-shrink-0 flex items-center justify-between">
          <h1 className="text-2xl font-black tracking-tight">Your shots</h1>
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/60">
            {photos.length} / {maxPhotos}
          </span>
        </div>

        {/* Scrollable content area */}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto space-y-4">

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((file, i) => (
                <div key={i} className="relative aspect-square">
                  <img
                    src={getPreviewUrl(file)}
                    alt=""
                    onClick={() => openReplace(i)}
                    className="h-full w-full cursor-pointer rounded-xl object-cover"
                  />
                  {uploadingIndex === i && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    </div>
                  )}
                  {failedIndex === i && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-red-900/60">
                      <span className="text-xs font-bold text-red-200">!</span>
                    </div>
                  )}
                  {uploadingIndex !== i && (
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 text-xs leading-none hover:bg-black"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!atCap && (
            <button
              type="button"
              onClick={() => addInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-[2rem] border-2 border-dashed border-white/20 bg-white/[0.04] px-5 py-6 text-center text-base font-bold text-white/65 transition hover:border-amber-200/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add photos ({maxPhotos - photos.length} left)
            </button>
          )}

          {error && (
            <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        {/* Fixed bottom CTA */}
        <div className="mt-4 flex-shrink-0">
          <button
            type="button"
            onClick={handleReady}
            disabled={!readyToUpload}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

        <input
          ref={addInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleAddFiles(e.target.files)}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleReplaceFile(e.target.files)}
        />
      </div>
    </main>
  )
}

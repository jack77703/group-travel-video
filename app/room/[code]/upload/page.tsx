'use client'

import { useParams, useRouter } from 'next/navigation'
import { ChangeEvent, useEffect, useRef, useState } from 'react'

import { getSession, Session } from '@/lib/session'

type MemberSummary = {
  id: string
  photos_uploaded: number
}

export default function UploadPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [session, setSessionState] = useState<Session | null>(null)
  const [maxPhotos, setMaxPhotos] = useState(5)
  const [uploaded, setUploaded] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const storedSession = getSession(code)
    if (!storedSession) {
      router.replace(`/room/${code}`)
      return
    }

    setSessionState(storedSession)
    fetch(`/api/rooms/${code}`)
      .then((res) => res.json())
      .then((data) => {
        setMaxPhotos(data.max_photos_per_member)
        const me = data.members?.find(
          (member: MemberSummary) => member.id === storedSession.memberId
        )
        if (me) {
          setUploaded(me.photos_uploaded)
        }
      })
      .catch(() => setError('Could not load room details'))
  }, [code, router])

  async function handleFiles(files: FileList | null) {
    if (!files || !session) return

    setError('')
    const slotsLeft = maxPhotos - uploaded
    const toUpload = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, slotsLeft)

    if (toUpload.length === 0) {
      setError(slotsLeft <= 0 ? 'All photo slots are filled' : 'Choose image files to upload')
      return
    }

    setUploading(true)

    for (const file of toUpload) {
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

        if (!res.ok || !data.upload_url) {
          throw new Error(data.error ?? 'Could not create upload URL')
        }

        const uploadRes = await fetch(data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!uploadRes.ok) {
          throw new Error('Upload failed')
        }

        setUploaded((prev) => prev + 1)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    }

    setUploading(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files)
  }

  const slotsLeft = Math.max(maxPhotos - uploaded, 0)
  const progress = maxPhotos > 0 ? Math.min((uploaded / maxPhotos) * 100, 100) : 0

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Room {code}
            </p>
            <h1 className="text-4xl font-black tracking-tight">Your Photos</h1>
            <p className="text-sm leading-6 text-white/55">
              Add your favorite shots. Nobody else sees them before the reel reveal.
            </p>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-sm text-white/50">Uploaded</p>
                <p className="text-3xl font-black">
                  {uploaded}
                  <span className="text-base font-semibold text-white/35"> / {maxPhotos}</span>
                </p>
              </div>
              {uploaded >= maxPhotos ? (
                <p className="rounded-full bg-emerald-300/15 px-3 py-1 text-sm font-bold text-emerald-200">
                  Done
                </p>
              ) : (
                <p className="rounded-full bg-white px-3 py-1 text-sm font-bold text-black">
                  {slotsLeft} left
                </p>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-amber-200 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {slotsLeft > 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-[2rem] border-2 border-dashed border-white/20 bg-white/[0.04] px-5 py-12 text-center text-lg font-bold text-white/65 transition hover:border-amber-200/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? 'Uploading...' : `Tap to add photos (${slotsLeft} left)`}
            </button>
          ) : (
            <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.06] px-5 py-12 text-center text-white/55">
              All slots filled
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />

          {error && (
            <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => router.push(`/room/${code}/lobby`)}
            disabled={uploaded < maxPhotos}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Done — Go to Lobby
          </button>
        </div>
      </div>
    </main>
  )
}

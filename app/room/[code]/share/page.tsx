'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'

export default function SharePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareError, setShareError] = useState('')
  const [resetting, setResetting] = useState(false)
  const isInitiator = !!getInitiatorToken(code)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/rooms/${code}/reel`)
        const data = await res.json()
        if (cancelled) return

        if (data.mp4_url) setDisplayedUrl(data.mp4_url)
        setLoading(false)

        if (data.room_status === 'done') return

        await new Promise<void>((resolve) => setTimeout(resolve, 5000))
        if (!cancelled) poll()
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    return () => { cancelled = true }
  }, [code])

  async function handleNativeShare() {
    if (!displayedUrl) return
    setShareError('')
    if (navigator.share) {
      try {
        if (navigator.canShare?.({ url: displayedUrl })) {
          await navigator.share({ url: displayedUrl, title: 'Our Reveel' })
          router.push('/')
          return
        }
        const res = await fetch(displayedUrl)
        const blob = await res.blob()
        const file = new File([blob], `reveel-${code}.mp4`, { type: 'video/mp4' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Our Reveel' })
          router.push('/')
          return
        }
        await navigator.share({ url: displayedUrl, title: 'Our Reveel' })
        router.push('/')
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setShareError('Could not open share sheet.')
        }
      }
    } else {
      await handleDownload()
    }
  }

  async function handleDownload() {
    if (!displayedUrl) return
    const res = await fetch(displayedUrl)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `reveel-${code}.mp4`
    link.click()
    URL.revokeObjectURL(url)
    router.push('/')
  }

  async function handleGenerateAgain() {
    const initiatorToken = getInitiatorToken(code)
    if (!initiatorToken) return
    setResetting(true)
    try {
      await fetch(`/api/rooms/${code}/reset`, {
        method: 'POST',
        headers: { 'x-initiator-token': initiatorToken },
      })
      router.push(`/room/${code}/generate`)
    } catch {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </main>
    )
  }

  if (!displayedUrl) {
    return (
      <main className="flex h-dvh items-center justify-center bg-black px-6 text-white">
        <div className="text-center">
          <p className="text-white/50">Reel not found.</p>
          <button type="button" onClick={() => router.push('/')} className="mt-4 text-sm text-amber-200 underline">
            Go home
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-dvh flex-col bg-black px-6 py-8 text-white">
      <div className="mx-auto flex h-full w-full max-w-md flex-col gap-4">
        <div className="flex-shrink-0 space-y-1 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Room {code}
          </p>
          <h1 className="text-2xl font-black tracking-tight">The reveal is ready</h1>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/40">
          <video
            ref={videoRef}
            src={displayedUrl}
            controls
            autoPlay
            playsInline
            className="h-full w-full rounded-[1.5rem] bg-black object-cover"
          />
        </div>

        <div className="flex-shrink-0 space-y-3">
          <button
            type="button"
            onClick={handleNativeShare}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
          >
            Share
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-lg font-bold text-white transition hover:border-white/25"
          >
            Download
          </button>

          {shareError && (
            <p className="text-center text-sm text-red-300">{shareError}</p>
          )}
        </div>

        {isInitiator && (
          <button
            type="button"
            onClick={handleGenerateAgain}
            disabled={resetting}
            className="flex-shrink-0 w-full py-2 text-sm text-white/30 transition hover:text-white/60 disabled:opacity-40"
          >
            {resetting ? 'Resetting...' : 'Generate Again'}
          </button>
        )}
      </div>
    </main>
  )
}

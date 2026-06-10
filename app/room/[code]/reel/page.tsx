'use client'

import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type ReelStatus = 'not_started' | 'processing' | 'done' | 'failed'

export default function ReelPage() {
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [mp4Url, setMp4Url] = useState<string | null>(null)
  const [status, setStatus] = useState<ReelStatus>('processing')
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`/api/rooms/${code}/reel`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error ?? 'Could not load reel')
        }

        setStatus(data.status)

        if (data.status === 'done' && data.mp4_url) {
          setMp4Url(data.mp4_url)
          if (pollRef.current) clearInterval(pollRef.current)
        } else if (data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load reel')
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }

    poll()
    pollRef.current = setInterval(poll, 5000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [code])

  async function handleDownload() {
    if (!mp4Url) return

    const res = await fetch(mp4Url)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `surprise-reel-${code}.mp4`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleShare() {
    if (!mp4Url) return

    if (navigator.share) {
      const res = await fetch(mp4Url)
      const blob = await res.blob()
      const file = new File([blob], `surprise-reel-${code}.mp4`, { type: 'video/mp4' })
      await navigator.share({ files: [file], title: 'Our Surprise Reel' })
      return
    }

    handleDownload()
  }

  if (status !== 'done' || !mp4Url) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-white">
        <div className="w-full max-w-sm space-y-5 text-center">
          {status === 'failed' || error ? (
            <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 px-5 py-8">
              <p className="text-lg font-bold text-red-200">Generation failed</p>
              <p className="mt-2 text-sm text-red-100/70">
                {error || 'Go back and try again.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-white border-t-transparent" />
              <div className="space-y-2">
                <h1 className="text-2xl font-black">Generating your reel...</h1>
                <p className="text-sm text-white/45">
                  This usually takes about a minute. Keep this page open.
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Room {code}
          </p>
          <h1 className="text-4xl font-black tracking-tight">The reveal is ready</h1>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/40">
          <video
            src={mp4Url}
            controls
            autoPlay
            playsInline
            className="aspect-[9/16] w-full rounded-[1.5rem] bg-black object-cover"
          />
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleShare}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
          >
            Share
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-lg font-bold text-white transition hover:border-white/25"
          >
            Download MP4
          </button>
        </div>
      </div>
    </main>
  )
}

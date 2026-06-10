'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function SharePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [mp4Url, setMp4Url] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareError, setShareError] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    fetch(`/api/rooms/${code}/reel`)
      .then((r) => r.json())
      .then((data) => {
        if (data.mp4_url) setMp4Url(data.mp4_url)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [code])

  async function handleNativeShare() {
    if (!mp4Url) return
    setShareError('')

    if (navigator.share) {
      try {
        if (navigator.canShare?.({ url: mp4Url })) {
          await navigator.share({ url: mp4Url, title: 'Our Surprise Reel' })
          return
        }
        const res = await fetch(mp4Url)
        const blob = await res.blob()
        const file = new File([blob], `surprise-reel-${code}.mp4`, { type: 'video/mp4' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Our Surprise Reel' })
          return
        }
        await navigator.share({ url: mp4Url, title: 'Our Surprise Reel' })
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
    if (!mp4Url) return
    const res = await fetch(mp4Url)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `surprise-reel-${code}.mp4`
    link.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
  }

  function socialLink(platform: 'threads' | 'twitter' | 'whatsapp') {
    if (!mp4Url) return '#'
    const text = encodeURIComponent('Our surprise reel is here 🎬')
    const url = encodeURIComponent(mp4Url)
    if (platform === 'threads') return `https://www.threads.net/intent/post?text=${text}%20${url}`
    if (platform === 'twitter') return `https://twitter.com/intent/tweet?text=${text}&url=${url}`
    return `https://wa.me/?text=${text}%20${url}`
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </main>
    )
  }

  if (!mp4Url) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="text-center">
          <p className="text-white/50">Reel not found.</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-4 text-sm text-amber-200 underline"
          >
            Go home
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col gap-6">
        <div className="space-y-1 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Room {code}
          </p>
          <h1 className="text-4xl font-black tracking-tight">The reveal is ready</h1>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/40">
          <video
            ref={videoRef}
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
            onClick={handleNativeShare}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
          >
            Share
          </button>

          <div className="grid grid-cols-3 gap-2">
            <a
              href={socialLink('threads')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.1]"
            >
              Threads
            </a>
            <a
              href={socialLink('twitter')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.1]"
            >
              Twitter
            </a>
            <a
              href={socialLink('whatsapp')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.1]"
            >
              WhatsApp
            </a>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-lg font-bold text-white transition hover:border-white/25"
          >
            {downloaded ? 'Downloaded!' : 'Download MP4'}
          </button>

          {shareError && (
            <p className="text-center text-sm text-red-300">{shareError}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => router.push('/create')}
          className="w-full py-3 text-sm text-white/30 transition hover:text-white/60"
        >
          Create another room
        </button>
      </div>
    </main>
  )
}

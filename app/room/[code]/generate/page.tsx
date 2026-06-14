'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'

type Track = {
  id: string
  name: string
  artist: string
  duration: number
  url: string
  image: string
}

const MOODS = [
  { label: 'Ambient', tag: 'ambient' },
  { label: 'Epic', tag: 'epic' },
  { label: 'Happy', tag: 'happy' },
  { label: 'Chill', tag: 'chill' },
  { label: 'Romantic', tag: 'romantic' },
  { label: 'Upbeat', tag: 'upbeat' },
  { label: 'Dark', tag: 'dark' },
  { label: 'Jazz', tag: 'jazz' },
  { label: 'Electronic', tag: 'electronic' },
]

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function loadSavedSettings(code: string) {
  try {
    const raw = localStorage.getItem(`reel_generate_settings_${code}`)
    return raw ? (JSON.parse(raw) as { mood: string; track: Track; pace: number }) : null
  } catch {
    return null
  }
}

function saveSettings(code: string, s: { mood: string; track: Track; pace: number }) {
  localStorage.setItem(`reel_generate_settings_${code}`, JSON.stringify(s))
}

type Status = 'idle' | 'loading-encoder' | 'encoding' | 'uploading'

export default function GeneratePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()

  const [selectedMood, setSelectedMood] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [fetchingTracks, setFetchingTracks] = useState(false)
  const [selected, setSelected] = useState<Track | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [pace, setPace] = useState(2)
  const [status, setStatus] = useState<Status>('idle')
  const [pct, setPct] = useState(0)
  const [dlPct, setDlPct] = useState(0)
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!getInitiatorToken(code)) {
      router.replace(`/room/${code}/lobby`)
      return
    }
    const saved = loadSavedSettings(code)
    if (saved) {
      setPace(Math.min(3, Math.max(1, saved.pace ?? 2)))
      if (saved.mood) {
        pendingTrackIdRef.current = saved.track?.id ?? null
        setSelectedMood(saved.mood)
      }
    }
  }, [code, router])

  useEffect(() => {
    if (!selectedMood) return
    setFetchingTracks(true)
    setTracks([])
    setSelected(null)
    fetch(`/api/music/search?mood=${selectedMood}`)
      .then((r) => r.json())
      .then((data) => {
        const fetched: Track[] = data.tracks ?? []
        setTracks(fetched)
        if (pendingTrackIdRef.current) {
          const found = fetched.find((t) => t.id === pendingTrackIdRef.current)
          setSelected(found ?? null)
          pendingTrackIdRef.current = null
        }
      })
      .catch(() => setTracks([]))
      .finally(() => setFetchingTracks(false))
  }, [selectedMood])

  function togglePreview(track: Track) {
    if (previewing === track.id) {
      audioRef.current?.pause()
      setPreviewing(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
    audioRef.current = new Audio(track.url)
    audioRef.current.play()
    audioRef.current.onended = () => setPreviewing(null)
    setPreviewing(track.id)
  }

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  async function handleGenerate() {
    if (!selected) return
    const initiatorToken = getInitiatorToken(code)
    if (!initiatorToken) {
      router.replace(`/room/${code}/lobby`)
      return
    }

    setStatus('idle')
    setError('')
    setPct(0)
    setDlPct(0)

    try {
      const genRes = await fetch(`/api/rooms/${code}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': initiatorToken,
        },
        body: JSON.stringify({
          music_url: selected.url,
          music_name: `${selected.name} — ${selected.artist}`,
          photo_duration: pace,
        }),
      })
      const genData = await genRes.json()
      if (!genRes.ok) throw new Error(genData.error)

      if (selectedMood) {
        saveSettings(code, { mood: selectedMood, track: selected, pace })
      }

      setStatus('loading-encoder')
      const { renderReel } = await import('@/lib/ffmpeg-renderer')

      const musicUrl = `/api/proxy-audio?url=${encodeURIComponent(selected.url)}`
      const blob = await renderReel({
        photos: genData.photos,
        musicUrl,
        photoDuration: pace,
        onProgress: setPct,
        onEncoderReady: () => setStatus('encoding'),
        onDownloadProgress: setDlPct,
      })

      const uploadUrlRes = await fetch(`/api/rooms/${code}/reel/upload-url`, {
        headers: { 'x-initiator-token': initiatorToken },
      })
      const uploadUrlData = await uploadUrlRes.json()
      if (!uploadUrlRes.ok) throw new Error('Failed to get upload URL')

      setStatus('uploading')
      let putRes: Response
      try {
        putRes = await fetch(uploadUrlData.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4' },
          body: blob,
        })
      } catch (netErr) {
        throw new Error(`Upload network error: ${netErr instanceof Error ? netErr.message : String(netErr)}`)
      }
      if (!putRes.ok) {
        const body = await putRes.text().catch(() => '')
        throw new Error(`Upload failed (${putRes.status})${body ? ': ' + body.slice(0, 300) : ''}`)
      }

      await fetch(`/api/rooms/${code}/reel/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': initiatorToken,
        },
        body: JSON.stringify({ storage_path: uploadUrlData.path }),
      })

      router.push(`/room/${code}/reel`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setError(msg === 'timeout'
        ? 'Video encoder took too long to load. Check your connection and tap Generate again.'
        : msg)
      setStatus('idle')
      // Reset room status so the user can try again without getting stuck.
      // keepalive ensures the request survives page unload — without it the
      // browser cancels the fetch when the user navigates away before it finishes.
      fetch(`/api/rooms/${code}/reset`, {
        method: 'POST',
        headers: { 'x-initiator-token': initiatorToken },
        keepalive: true,
      }).catch(() => {})
    }
  }

  const busy = status !== 'idle'

  function statusLabel() {
    if (status === 'loading-encoder') {
      if (dlPct >= 100) return 'Initializing encoder…'
      if (dlPct > 0)    return `Downloading encoder… ${dlPct}%`
      return 'Loading encoder…'
    }
    if (status === 'encoding') return `Encoding… ${pct}%`
    if (status === 'uploading') return 'Uploading…'
    return 'Generate Reel'
  }

  return (
    <main className="h-dvh overflow-hidden bg-black px-6 py-8 text-white">
      <div className="mx-auto flex h-full w-full max-w-md flex-col gap-3">
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 transition hover:border-white/30 hover:text-white/80"
          >
            ← Home
          </button>
        </div>
        <div className="flex-shrink-0">
          <h1 className="text-3xl font-black tracking-tight">Pick a vibe</h1>
        </div>

        <div className="flex-shrink-0 grid grid-cols-3 gap-2">
          {MOODS.map(({ label, tag }) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedMood(tag)}
              disabled={busy}
              className={`rounded-2xl py-3 text-sm font-semibold transition ${
                selectedMood === tag
                  ? 'bg-amber-200 text-black'
                  : 'border border-white/15 bg-white/[0.06] text-white/60 hover:border-white/30 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {fetchingTracks && (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            </div>
          )}
          {!fetchingTracks && !selectedMood && (
            <p className="py-8 text-center text-sm text-white/30">Select a vibe above</p>
          )}
          {!fetchingTracks && selectedMood && tracks.length === 0 && (
            <p className="py-8 text-center text-sm text-white/30">No tracks found</p>
          )}
          {tracks.map((track) => {
            const isSelected = selected?.id === track.id
            const isPreviewing = previewing === track.id
            return (
              <div
                key={track.id}
                onClick={() => !busy && setSelected(track)}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                  isSelected
                    ? 'border-amber-200/60 bg-amber-200/10'
                    : 'border-white/10 bg-white/[0.04] hover:border-white/20'
                }`}
              >
                {track.image ? (
                  <img src={track.image} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-tight">{track.name}</p>
                  <p className="truncate text-xs text-white/45">
                    {track.artist} · {formatDuration(track.duration)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePreview(track) }}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  {isPreviewing ? '■' : '▶'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-white/70">Pace</span>
            <span className="rounded-full bg-white px-3 py-0.5 text-sm font-bold text-black">{pace}s</span>
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={1}
            value={pace}
            onChange={(e) => setPace(Number(e.target.value))}
            disabled={busy}
            className="w-full accent-amber-200"
          />
          <div className="mt-0.5 flex justify-between text-xs text-white/30">
            <span>Fast</span>
            <span>Slow</span>
          </div>
        </div>

        {status === 'loading-encoder' && dlPct > 0 && dlPct < 100 && (
          <div className="flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-white/50">
              <span>Downloading encoder</span>
              <span>{dlPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10">
              <div
                className="h-1.5 rounded-full bg-amber-200/50 transition-all"
                style={{ width: `${dlPct}%` }}
              />
            </div>
          </div>
        )}

        {status === 'encoding' && (
          <div className="flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-white/50">
              <span>Encoding video</span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10">
              <div
                className="h-1.5 rounded-full bg-amber-200 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="flex-shrink-0 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!selected || busy}
          className="flex-shrink-0 w-full rounded-2xl bg-white px-5 py-3 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {statusLabel()}
        </button>
      </div>
    </main>
  )
}

'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'

interface Track {
  id: string
  name: string
  artist: string
  duration: number
  url: string
  image: string
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function GeneratePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()

  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Track | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!getInitiatorToken(code)) {
      router.replace(`/room/${code}/lobby`)
    }
  }, [code, router])

  const search = useCallback(async (q: string) => {
    setSearching(true)
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setTracks(data.tracks ?? [])
    } catch {
      setTracks([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    search('')
  }, [search])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, search])

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

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/rooms/${code}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': initiatorToken,
        },
        body: JSON.stringify({ music_url: selected.url, music_name: `${selected.name} — ${selected.artist}` }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/room/${code}/reel`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-black px-6 py-8 text-white">
      <div className="mx-auto flex h-full w-full max-w-md flex-col gap-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Room {code}
          </p>
          <h1 className="text-4xl font-black tracking-tight">Pick a track</h1>
          <p className="text-sm text-white/50">Search and preview before generating.</p>
        </div>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by song or artist..."
            className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 pr-10 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200 focus:ring-4 focus:ring-amber-200/10"
          />
          {searching && (
            <div className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {tracks.map((track) => {
            const isSelected = selected?.id === track.id
            const isPreviewing = previewing === track.id

            return (
              <div
                key={track.id}
                onClick={() => setSelected(track)}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                  isSelected
                    ? 'border-white bg-white/10'
                    : 'border-white/10 bg-white/[0.04] hover:border-white/20'
                }`}
              >
                {track.image ? (
                  <img
                    src={track.image}
                    alt=""
                    className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                  />
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
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePreview(track)
                  }}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  {isPreviewing ? '■' : '▶'}
                </button>
              </div>
            )
          })}

          {!searching && tracks.length === 0 && (
            <p className="py-8 text-center text-sm text-white/30">No tracks found</p>
          )}
        </div>

        {selected && (
          <div className="rounded-2xl border border-amber-200/20 bg-amber-200/5 px-4 py-3 text-sm">
            <p className="text-amber-200/60">Selected</p>
            <p className="font-semibold">{selected.name}</p>
            <p className="text-white/50">{selected.artist}</p>
          </div>
        )}

        {error && (
          <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!selected || loading}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Starting generation...' : 'Generate Reel'}
        </button>
      </div>
    </main>
  )
}

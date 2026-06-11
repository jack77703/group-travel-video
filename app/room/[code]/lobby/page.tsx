'use client'

import { RealtimeChannel } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'
import { getSupabaseClient } from '@/lib/supabase-client'
import type { MemberPublic, RoomPublic } from '@/lib/types'

export default function LobbyPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [room, setRoom] = useState<RoomPublic | null>(null)
  const [isInitiator, setIsInitiator] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)

  const loadRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load room')
      setRoom(data)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load room')
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let cancelled = false

    setIsInitiator(!!getInitiatorToken(code))

    async function subscribeToLobby() {
      await loadRoom()

      const res = await fetch(`/api/rooms/${code}`)
      const data: RoomPublic = await res.json()
      if (cancelled || !data.id) return

      const supabase = getSupabaseClient()
      channel = supabase
        .channel(`lobby-${data.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'members', filter: `room_id=eq.${data.id}` },
          () => loadRoom()
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${data.id}` },
          () => loadRoom()
        )
        .subscribe()
    }

    subscribeToLobby()

    return () => {
      cancelled = true
      if (channel) getSupabaseClient().removeChannel(channel)
    }
  }, [code, loadRoom])

  async function handleShareInvite() {
    const url = `${window.location.origin}/room/${code}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: room?.name ?? 'Reveel Room',
          text: 'Join my Reveel room and upload your secret photos!',
          url,
        })
      } catch (err) {
        // User dismissed the share sheet — not an error
        if (err instanceof Error && err.name === 'AbortError') return
        // Unexpected error — fall back to clipboard
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }
    } else {
      // Desktop browsers without share support — copy to clipboard
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
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

  if (loading || !room) {
    return (
      <main className="flex h-dvh items-center justify-center bg-black px-6 text-white">
        <p className="text-white/45">Loading...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex h-dvh items-center justify-center bg-black px-6 text-white">
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      </main>
    )
  }

  const maxMembers = Math.min(20, Math.floor(60 / room.max_photos_per_member))
  const allZero = room.members.every((m: MemberPublic) => m.photos_uploaded === 0)

  return (
    <main className="flex h-dvh flex-col bg-black px-6 py-8 text-white">
      {/* Top bar */}
      <div className="flex-shrink-0">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 transition hover:border-white/30 hover:text-white/80"
        >
          ← Home
        </button>
      </div>

      {/* Room info */}
      <div className="mt-5 flex-shrink-0">
        <h1 className="text-3xl font-black tracking-tight">{room.name}</h1>
        <p className="mt-1 text-sm text-white/40">
          {room.members.length} / {maxMembers} members
        </p>
      </div>

      {/* Member list — only this area scrolls */}
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {room.members.map((member: MemberPublic) => {
          const hasUploaded = member.photos_uploaded > 0
          const initials = member.name.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
          return (
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.05] px-4 py-3"
            >
              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${hasUploaded ? 'bg-amber-200/20 text-amber-200' : 'bg-white/10 text-white/50'}`}>
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{member.name}</p>
                  {member.is_initiator && (
                    <span className="flex-shrink-0 rounded-full bg-amber-200/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
                      Host
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/35">
                  {hasUploaded ? `${member.photos_uploaded} photo${member.photos_uploaded === 1 ? '' : 's'} ready` : 'waiting…'}
                </p>
              </div>
              {hasUploaded && (
                <div className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
              )}
            </div>
          )
        })}
      </div>

      {/* Footer — three states */}
      <div className="mt-5 flex-shrink-0 space-y-3">
        {isInitiator && (
          <button
            type="button"
            onClick={handleShareInvite}
            className="w-full rounded-2xl border border-amber-200/40 bg-amber-200/10 px-5 py-3 text-base font-bold text-amber-200 transition hover:bg-amber-200/20 active:scale-[0.99]"
          >
            {copied ? 'Link copied!' : 'Invite friends ↗'}
          </button>
        )}

        {room.status === 'open' && isInitiator && (
          <button
            type="button"
            onClick={() => router.push(`/room/${code}/generate`)}
            disabled={allZero}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Generate Reel
          </button>
        )}

        {room.status === 'open' && !isInitiator && (
          <p className="py-3 text-center text-sm text-white/40">
            Waiting for the host to generate the reel...
          </p>
        )}

        {room.status === 'generating' && (
          <div className="flex items-center justify-center gap-3 py-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-sm text-white/60">Generating your reel...</p>
          </div>
        )}

        {room.status === 'done' && (
          <>
            <button
              type="button"
              onClick={() => router.push(`/room/${code}/share`)}
              className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
            >
              Watch the Reel →
            </button>
            {isInitiator && (
              <button
                type="button"
                onClick={handleGenerateAgain}
                disabled={resetting}
                className="w-full py-2 text-sm text-white/30 transition hover:text-white/60 disabled:opacity-40"
              >
                {resetting ? 'Resetting...' : 'Generate Again'}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  )
}

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

  const loadRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? 'Could not load room')
      }

      setRoom(data)
      setLoading(false)

      if (data.status === 'done' || data.status === 'generating') {
        router.replace(`/room/${code}/reel`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load room')
      setLoading(false)
    }
  }, [code, router])

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
          {
            event: '*',
            schema: 'public',
            table: 'members',
            filter: `room_id=eq.${data.id}`,
          },
          () => loadRoom()
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'rooms',
            filter: `id=eq.${data.id}`,
          },
          (payload) => {
            const nextStatus = payload.new.status
            if (nextStatus === 'done' || nextStatus === 'generating') {
              router.replace(`/room/${code}/reel`)
              return
            }
            loadRoom()
          }
        )
        .subscribe((status) => {
          console.log('Realtime status:', status)
        })
    }

    subscribeToLobby()

    return () => {
      cancelled = true
      if (channel) {
        getSupabaseClient().removeChannel(channel)
      }
    }
  }, [code, loadRoom, router])

  if (loading || !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <p className="text-white/45">Loading lobby...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col">
        <div className="space-y-8">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Room {room.code}
            </p>
            <h1 className="text-4xl font-black tracking-tight">{room.name}</h1>
          </div>

          <div className="flex-1 space-y-3">
            {room.members.map((member: MemberPublic) => {
              const hasUploaded = member.photos_uploaded > 0

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{member.name}</p>
                      {member.is_initiator && (
                        <span className="rounded-full bg-amber-200/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
                          Host
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40">
                      {member.photos_uploaded} photo{member.photos_uploaded === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      hasUploaded
                        ? 'bg-emerald-300/15 text-emerald-200'
                        : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {hasUploaded ? 'uploaded' : 'waiting'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-auto pt-8">
          {isInitiator ? (
            <button
              type="button"
              onClick={() => router.push(`/room/${code}/generate`)}
              disabled={room.members.every((m: MemberPublic) => m.photos_uploaded === 0)}
              className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
            >
              Generate Reel
            </button>
          ) : (
            <p className="text-center text-sm text-white/40">
              Waiting for the host to generate the reel...
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

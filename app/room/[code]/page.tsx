'use client'

import { useParams, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'

import { getSession, setSession } from '@/lib/session'

export default function JoinPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [name, setName] = useState('')
  const [roomName, setRoomName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (getSession(code)) {
      router.replace(`/room/${code}/lobby`)
      return
    }
    fetch(`/api/rooms/${code}`)
      .then((r) => r.json())
      .then((data) => { if (data.name) setRoomName(data.name) })
      .catch(() => {})
  }, [code, router])

  async function handleJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error)
      }

      setSession(code, {
        token: data.session_token,
        roomCode: code,
        memberId: data.member_id,
        memberName: data.name,
        roomName: data.room_name,
      })
      router.push(`/room/${code}/upload`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-dvh overflow-hidden bg-black px-6 py-6 text-white">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center">
        <div className="mb-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 transition hover:border-white/30 hover:text-white/80"
          >
            ← Home
          </button>
        </div>
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/40">
              <p className="text-xs text-white/35 uppercase tracking-[0.2em]">You're invited to</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
                {roomName ?? '…'}
              </h1>
            </div>
            <p className="text-sm text-white/45">
              Upload secretly. Everything stays hidden until the big reveal.
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-base text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/60 focus:ring-4 focus:ring-amber-200/10"
            />

            {error && (
              <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full rounded-2xl bg-white px-5 py-4 text-base font-bold text-black transition hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Joining...' : 'Join'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}

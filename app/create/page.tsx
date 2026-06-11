'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { setInitiatorToken, setSession } from '@/lib/session'

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [initiatorName, setInitiatorName] = useState('')
  const [requiredPhotos, setRequiredPhotos] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          max_photos_per_member: requiredPhotos,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error)
      }

      const joinRes = await fetch(`/api/rooms/${data.code}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': data.created_by_token,
        },
        body: JSON.stringify({ name: initiatorName }),
      })
      const joinData = await joinRes.json()

      if (!joinRes.ok) {
        throw new Error(joinData.error)
      }

      setInitiatorToken(data.code, data.created_by_token)
      setSession(data.code, {
        token: joinData.session_token,
        roomCode: data.code,
        memberId: joinData.member_id,
        memberName: joinData.name,
        roomName: name,
      })
      router.push(`/room/${data.code}/upload`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-dvh overflow-hidden bg-black px-6 py-6 text-white">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center">
        <div className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight">New Room</h1>
            <p className="text-sm text-white/40">Name the moment, pick a photo count, then invite everyone.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name — e.g. New York Trip"
              required
              className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/60 focus:ring-4 focus:ring-amber-200/10"
            />

            <input
              value={initiatorName}
              onChange={(e) => setInitiatorName(e.target.value)}
              placeholder="Your name"
              required
              className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/60 focus:ring-4 focus:ring-amber-200/10"
            />

            <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-white/55">Photos per person</span>
                <span className="rounded-full bg-amber-200 px-3 py-0.5 text-sm font-bold text-black">
                  {requiredPhotos}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={requiredPhotos}
                onChange={(e) => setRequiredPhotos(Number(e.target.value))}
                className="w-full accent-amber-200"
              />
              <p className="mt-2 text-xs text-white/30">
                Up to {Math.min(20, Math.floor(60 / requiredPhotos))} members
              </p>
            </div>

            {error && (
              <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim() || !initiatorName.trim()}
              className="w-full rounded-2xl bg-white px-5 py-4 text-base font-bold text-black transition hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}

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
      })
      router.push(`/room/${data.code}/upload`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Start the surprise
            </p>
            <h1 className="text-4xl font-black tracking-tight">Create a Reel Room</h1>
            <p className="text-sm leading-6 text-white/55">
              Name the moment, set how many photos each person must upload, then share the room.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-white/70">Room name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bali Trip 2026"
                required
                className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200 focus:ring-4 focus:ring-amber-200/10"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-white/70">Your name</label>
              <input
                value={initiatorName}
                onChange={(e) => setInitiatorName(e.target.value)}
                placeholder="e.g. Jack"
                required
                className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200 focus:ring-4 focus:ring-amber-200/10"
              />
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <label className="mb-3 flex items-center justify-between text-sm font-medium text-white/70">
                <span>Required photos per person</span>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-black">
                  {requiredPhotos}
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={requiredPhotos}
                onChange={(e) => setRequiredPhotos(Number(e.target.value))}
                className="w-full accent-amber-200"
              />
              <p className="mt-2 text-xs text-white/35">
                Everyone must upload exactly {requiredPhotos} photo{requiredPhotos !== 1 ? 's' : ''} before you can generate the reel.
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
              className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Creating...' : 'Create Room'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}

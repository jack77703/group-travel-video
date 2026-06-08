'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { setInitiatorToken } from '@/lib/session'

const OCCASIONS = ['Trip', 'Birthday', 'Wedding', 'Company Event', 'Graduation', 'Other']

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [occasion, setOccasion] = useState('')
  const [maxPhotos, setMaxPhotos] = useState(5)
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
          occasion,
          max_photos_per_member: maxPhotos,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error)
      }

      setInitiatorToken(data.code, data.created_by_token)
      router.push(`/room/${data.code}/lobby`)
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
              Name the moment, set a photo limit, then share the room with your group.
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
              <label className="mb-3 block text-sm font-medium text-white/70">Occasion</label>
              <div className="grid grid-cols-2 gap-2">
                {OCCASIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setOccasion(option)}
                    className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                      occasion === option
                        ? 'border-white bg-white text-black'
                        : 'border-white/10 bg-white/[0.07] text-white/70 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <label className="mb-3 flex items-center justify-between text-sm font-medium text-white/70">
                <span>Max photos per person</span>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-black">
                  {maxPhotos}
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={maxPhotos}
                onChange={(e) => setMaxPhotos(Number(e.target.value))}
                className="w-full accent-amber-200"
              />
            </div>

            {error && (
              <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !name || !occasion}
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

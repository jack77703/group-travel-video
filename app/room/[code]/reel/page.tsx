'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'

type ReelStatus = 'not_started' | 'processing' | 'done' | 'failed'

export default function ReelPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [status, setStatus] = useState<ReelStatus>('processing')
  const [roomStatus, setRoomStatus] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isInitiator = !!getInitiatorToken(code)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`/api/rooms/${code}/reel`)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error ?? 'Could not load reel')

        setStatus(data.status)
        setRoomStatus(data.room_status)

        if (data.status === 'done' && data.mp4_url) {
          if (pollRef.current) clearInterval(pollRef.current)
          router.replace(`/room/${code}/share`)
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
  }, [code, router])

  async function handleReset() {
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

  // Stuck: room is generating but no reel entry exists (client-side encode was interrupted)
  const isStuck = roomStatus === 'generating' && status === 'not_started'

  return (
    <main className="flex h-dvh flex-col items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-sm space-y-5 text-center">
        {status === 'failed' || error ? (
          <div className="space-y-4">
            <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 px-5 py-8">
              <p className="text-lg font-bold text-red-200">Generation failed</p>
              <p className="mt-2 text-sm text-red-100/70">
                {error || 'Go back and try again.'}
              </p>
            </div>
            {isInitiator && (
              <button
                type="button"
                onClick={handleReset}
                disabled={resetting}
                className="w-full rounded-2xl bg-white px-5 py-4 text-base font-bold text-black transition hover:bg-amber-100 disabled:opacity-40"
              >
                {resetting ? 'Resetting...' : 'Try Again'}
              </button>
            )}
          </div>
        ) : isStuck && isInitiator ? (
          <div className="space-y-4">
            <div className="rounded-[2rem] border border-amber-400/20 bg-amber-500/10 px-5 py-8">
              <p className="text-lg font-bold text-amber-200">Encoding was interrupted</p>
              <p className="mt-2 text-sm text-amber-100/70">
                The video encoding didn't finish. Try generating again.
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="w-full rounded-2xl bg-white px-5 py-4 text-base font-bold text-black transition hover:bg-amber-100 disabled:opacity-40"
            >
              {resetting ? 'Resetting...' : 'Try Again'}
            </button>
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

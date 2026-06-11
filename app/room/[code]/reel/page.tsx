'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type ReelStatus = 'not_started' | 'processing' | 'done' | 'failed'

export default function ReelPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [status, setStatus] = useState<ReelStatus>('processing')
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`/api/rooms/${code}/reel`)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error ?? 'Could not load reel')

        setStatus(data.status)

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

  return (
    <main className="flex h-dvh flex-col items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-sm space-y-5 text-center">
        {status === 'failed' || error ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 px-5 py-8">
            <p className="text-lg font-bold text-red-200">Generation failed</p>
            <p className="mt-2 text-sm text-red-100/70">
              {error || 'Go back and try again.'}
            </p>
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

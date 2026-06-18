'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { listSessions, removeSession, Session } from '@/lib/session'

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Create a room',
    desc: 'Name your trip and set how many photos each person contributes.',
  },
  {
    step: '2',
    title: 'Everyone uploads secretly',
    desc: "Share the link. Each person adds their best shots — nobody sees anyone else's until the reveal.",
  },
  {
    step: '3',
    title: 'Watch the reveal together',
    desc: 'Hit generate. Reveel turns all the photos into one video set to music. Surprise guaranteed.',
  },
]

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setSessions(listSessions())
    setLoaded(true)
  }, [])

  function handleRemove(roomCode: string) {
    removeSession(roomCode)
    setSessions((prev) => prev.filter((s) => s.roomCode !== roomCode))
  }

  return (
    <main className="min-h-dvh bg-black px-6 pb-10 text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-16 top-10 h-64 w-64 rounded-full bg-amber-300/15 blur-3xl" />
        <div className="absolute -right-20 top-32 h-72 w-72 rounded-full bg-sky-400/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-md space-y-8 pt-16">
        <div className="space-y-3">
          <h1 className="text-5xl font-black leading-[0.95] tracking-tight">Reveel</h1>
          <p className="text-base text-white/55">Everyone uploads secretly. Nobody sees it coming.</p>
        </div>

        {loaded && sessions.length === 0 && (
          <div className="space-y-2">
            {HOW_IT_WORKS.map(({ step, title, desc }) => (
              <div
                key={step}
                className="flex gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-4"
              >
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-200/15 text-xs font-bold text-amber-200">
                  {step}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/45">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {loaded && sessions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30">Your rooms</p>
            {sessions.map((s) => (
              <div key={s.roomCode} className="flex items-center gap-2">
                <Link
                  href={`/room/${s.roomCode}/lobby`}
                  className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 transition active:bg-white/[0.09]"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-200/15 text-sm font-bold text-amber-200">
                    {s.roomName?.slice(0, 2).toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{s.roomName}</p>
                    <p className="text-xs text-white/35">as {s.memberName}</p>
                  </div>
                  <span className="text-xs text-white/25">Open →</span>
                </Link>
                <button
                  type="button"
                  onClick={() => handleRemove(s.roomCode)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 text-white/30 transition hover:border-red-400/30 hover:text-red-300"
                  aria-label="Remove room"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <Link
          href="/create"
          className="block w-full rounded-2xl bg-white px-5 py-4 text-center text-base font-bold text-black transition hover:bg-amber-100 active:scale-[0.99]"
        >
          New Room
        </Link>
      </div>
    </main>
  )
}

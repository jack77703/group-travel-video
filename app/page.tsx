'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { listSessions, removeSession, Session } from '@/lib/session'

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    setSessions(listSessions())
  }, [])

  function handleRemove(roomCode: string) {
    removeSession(roomCode)
    setSessions((prev) => prev.filter((s) => s.roomCode !== roomCode))
  }

  return (
    <main className="h-dvh overflow-y-auto bg-black px-6 text-white">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-8">
        <div className="relative">
          <div className="absolute -left-16 -top-20 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="absolute -right-20 top-24 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />

          <div className="relative space-y-8">
            <div className="space-y-5">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
                upload secretly
                <span className="text-amber-300">↗</span>
              </p>
              <div className="space-y-4">
                <h1 className="text-5xl font-black leading-[0.95] tracking-tight">
                  Reveel
                </h1>
                <div className="space-y-1 text-lg font-medium leading-8 text-white/65">
                  <p>Everyone brings their best shots&nbsp;&mdash; secretly.</p>
                  <p>Nobody sees it coming.</p>
                </div>
              </div>
            </div>

            {sessions.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                  Your rooms
                </p>
                {sessions.map((s) => (
                  <div key={s.roomCode} className="flex items-center gap-2">
                    <Link
                      href={`/room/${s.roomCode}/lobby`}
                      className="flex flex-1 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.09]"
                    >
                      <div>
                        <p className="text-sm font-bold text-white">{s.roomName}</p>
                        <p className="text-xs text-white/40">You joined as {s.memberName}</p>
                      </div>
                      <span className="text-xs text-white/30">Rejoin →</span>
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
              className="block w-full rounded-2xl bg-white px-5 py-4 text-center text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
            >
              Create a Reel Room
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

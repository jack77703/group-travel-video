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
    <main className="h-dvh overflow-hidden bg-black px-6 text-white">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-8">
        <div className="relative">
          <div className="absolute -left-16 -top-20 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="absolute -right-20 top-24 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />

          <div className="relative space-y-8">
            <div className="space-y-3">
              <h1 className="text-5xl font-black leading-[0.95] tracking-tight">Reveel</h1>
              <p className="text-base text-white/55">Upload secretly. Nobody sees it coming.</p>
            </div>

            {sessions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30">
                  Your rooms
                </p>
                {sessions.map((s) => (
                  <div key={s.roomCode} className="flex items-center gap-2">
                    <Link
                      href={`/room/${s.roomCode}/lobby`}
                      className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 transition active:bg-white/[0.09]"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-200/15 text-sm font-bold text-amber-200">
                        {s.roomName.slice(0, 2).toUpperCase()}
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
        </div>
      </div>
    </main>
  )
}

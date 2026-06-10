'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { listSessions, Session } from '@/lib/session'

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    setSessions(listSessions())
  }, [])

  return (
    <main className="min-h-screen overflow-hidden bg-black px-6 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center py-12">
        <div className="relative">
          <div className="absolute -left-16 -top-20 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="absolute -right-20 top-24 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />

          <div className="relative space-y-10">
            <div className="space-y-5">
              <p className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
                Private group recap
              </p>
              <div className="space-y-4">
                <h1 className="text-5xl font-black leading-[0.95] tracking-tight">
                  Surprise Reel
                </h1>
                <p className="text-lg leading-7 text-white/65">
                  Everyone uploads secretly. You hit generate. They&apos;re surprised.
                </p>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="aspect-[9/12] rounded-[1.5rem] bg-gradient-to-br from-white via-amber-200 to-sky-300 p-1">
                <div className="flex h-full flex-col justify-between rounded-[1.25rem] bg-black p-5">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-24 rounded-2xl bg-white/20" />
                    <div className="h-24 rounded-2xl bg-amber-300/70" />
                    <div className="h-24 rounded-2xl bg-sky-300/70" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-2/3 rounded-full bg-white/80" />
                    <div className="h-3 w-1/2 rounded-full bg-white/30" />
                  </div>
                </div>
              </div>
            </div>

            {sessions.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                  Your rooms
                </p>
                {sessions.map((s) => (
                  <Link
                    key={s.roomCode}
                    href={`/room/${s.roomCode}/lobby`}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.09]"
                  >
                    <div>
                      <p className="font-mono text-sm font-bold tracking-widest text-amber-100">
                        {s.roomCode}
                      </p>
                      <p className="text-xs text-white/40">{s.memberName}</p>
                    </div>
                    <span className="text-xs text-white/30">Rejoin →</span>
                  </Link>
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

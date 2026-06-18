import { NextRequest, NextResponse } from 'next/server'

import { getIp, rateLimit } from '@/lib/rate-limit'

const VALID_MOODS = ['ambient', 'epic', 'happy', 'chill', 'romantic', 'upbeat', 'dark', 'jazz', 'electronic']

export async function GET(request: NextRequest) {
  if (!rateLimit(getIp(request), 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const mood = request.nextUrl.searchParams.get('mood') ?? ''

  const url = new URL('https://api.jamendo.com/v3.0/tracks/')
  url.searchParams.set('client_id', process.env.JAMENDO_CLIENT_ID!)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '10')
  url.searchParams.set('audioformat', 'mp32')
  url.searchParams.set('imagesize', '100')
  url.searchParams.set('vocalinstrumental', 'instrumental')
  url.searchParams.set('order', 'popularity_total')

  if (mood && VALID_MOODS.includes(mood)) {
    url.searchParams.set('tags', mood)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    return NextResponse.json({ error: 'Music search failed' }, { status: 502 })
  }

  const data = await res.json()

  const tracks = (data.results ?? []).map((t: {
    id: string
    name: string
    artist_name: string
    duration: number
    audio: string
    image: string
  }) => ({
    id: t.id,
    name: t.name,
    artist: t.artist_name,
    duration: t.duration,
    url: t.audio,
    image: t.image,
  }))

  return NextResponse.json({ tracks })
}

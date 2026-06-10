import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''

  const url = new URL('https://api.jamendo.com/v3.0/tracks/')
  url.searchParams.set('client_id', process.env.JAMENDO_CLIENT_ID!)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '20')
  url.searchParams.set('audioformat', 'mp32')
  url.searchParams.set('imagesize', '100')

  if (q.trim()) {
    url.searchParams.set('search', q.trim())
  } else {
    url.searchParams.set('order', 'popularity_total')
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

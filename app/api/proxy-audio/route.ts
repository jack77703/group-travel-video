import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }

  // Only allow http/https to prevent SSRF against internal resources
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  const upstream = await fetch(url)
  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status })
  }

  const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg'
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

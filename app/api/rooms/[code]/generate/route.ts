import { Client as CreatomateClient } from 'creatomate'
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

type PhotoRow = {
  storage_path: string
}

function buildAnimations(type: string) {
  if (type === 'zoom-out') {
    return [{ type: 'scale', scope: 'element', easing: 'linear', start_scale: '110%', end_scale: '100%' }]
  }
  if (type === 'static') {
    return []
  }
  return [{ type: 'scale', scope: 'element', easing: 'linear', start_scale: '100%', end_scale: '110%' }]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  const { music_url, music_name, photo_duration = 2, animation = 'zoom-in' } = await request.json()

  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!music_url) {
    return NextResponse.json({ error: 'No music track selected' }, { status: 400 })
  }
  if (photo_duration < 1 || photo_duration > 3) {
    return NextResponse.json({ error: 'photo_duration must be between 1 and 3' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, created_by_token')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.created_by_token !== initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (room.status !== 'open') {
    return NextResponse.json({ error: 'Reel already generating or done' }, { status: 409 })
  }

  const { data: rawPhotos } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('room_id', room.id)

  if (!rawPhotos || rawPhotos.length === 0) {
    return NextResponse.json({ error: 'No photos uploaded' }, { status: 400 })
  }

  const photos = shuffle(rawPhotos as PhotoRow[])

  const photoItems: Array<{ url: string }> = []
  for (const photo of photos) {
    const { data } = await supabase.storage
      .from('photos')
      .createSignedUrl(photo.storage_path, 86400)
    if (data?.signedUrl) {
      photoItems.push({ url: data.signedUrl })
    }
  }

  const totalDuration = photo_duration * photoItems.length
  const animations = buildAnimations(animation)

  const creatomate = new CreatomateClient(process.env.CREATOMATE_API_KEY!)
  const renders = await creatomate.startRender({
    renderScale: 1,
    source: {
      output_format: 'mp4',
      width: 1080,
      height: 1920,
      frame_rate: 30,
      crf: 18,
      fill_color: '#000000',
      elements: [
        {
          type: 'audio',
          source: music_url,
          duration: totalDuration,
          audio_fade_out: 2,
        },
        ...photoItems.map(({ url }, i) => ({
          type: 'image',
          source: url,
          time: i * photo_duration,
          duration: photo_duration,
          width: '100%',
          height: '100%',
          x: '50%',
          y: '50%',
          fit: 'cover',
          ...(animations.length > 0 ? { animations } : {}),
        })),
      ],
    },
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/creatomate`,
  })

  const render_id = renders[0].id

  await supabase
    .from('rooms')
    .update({ status: 'generating', music_genre: music_name ?? music_url })
    .eq('id', room.id)

  const { error: reelUpsertError } = await supabase
    .from('reels')
    .upsert(
      { room_id: room.id, render_id, status: 'processing', mp4_url: null },
      { onConflict: 'room_id' }
    )

  if (reelUpsertError) {
    console.error('[generate] reel upsert failed:', reelUpsertError)
    await supabase.from('rooms').update({ status: 'open' }).eq('id', room.id)
    return NextResponse.json({ error: 'Failed to start reel generation' }, { status: 500 })
  }

  return NextResponse.json({ render_id, status: 'processing' })
}

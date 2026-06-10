import { Client as CreatomateClient } from 'creatomate'
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  const { music_url, music_name } = await request.json()

  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!music_url) {
    return NextResponse.json({ error: 'No music track selected' }, { status: 400 })
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

  const { data: photos } = await supabase
    .from('photos')
    .select('storage_path, display_order')
    .eq('room_id', room.id)
    .order('display_order', { ascending: true })

  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: 'No photos uploaded' }, { status: 400 })
  }

  const photoUrls: string[] = []
  for (const photo of photos) {
    const { data } = await supabase.storage
      .from('photos')
      .createSignedUrl(photo.storage_path, 3600)
    if (data?.signedUrl) photoUrls.push(data.signedUrl)
  }

  const PHOTO_DURATION = 3

  const creatomate = new CreatomateClient(process.env.CREATOMATE_API_KEY!)
  const renders = await creatomate.render({
    source: {
      output_format: 'mp4',
      width: 1080,
      height: 1920,
      fill_color: '#000000',
      elements: [
        {
          type: 'audio',
          source: music_url,
          duration: PHOTO_DURATION * photoUrls.length,
          audio_fade_out: 2,
        },
        ...photoUrls.map((url, i) => ({
          type: 'image',
          source: url,
          time: i * PHOTO_DURATION,
          duration: PHOTO_DURATION,
          fit: 'cover',
          animations: [
            {
              type: 'scale',
              scope: 'element',
              easing: 'linear',
              start_scale: '100%',
              end_scale: '110%',
            },
          ],
        })),
      ],
    },
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/creatomate`,
  })

  const render_id = renders[0].id
  console.log('[generate] render_id:', render_id, 'room.id:', room.id)

  await supabase
    .from('rooms')
    .update({ status: 'generating', music_genre: music_name ?? music_url })
    .eq('id', room.id)

  const { error: reelInsertError } = await supabase.from('reels').insert({ room_id: room.id, render_id, status: 'processing' })
  console.log('[generate] reel insert error:', JSON.stringify(reelInsertError))

  return NextResponse.json({ render_id, status: 'processing' })
}

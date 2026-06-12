import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

type PhotoRow = {
  storage_path: string
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
  const { music_url, music_name, photo_duration = 2 } = await request.json()

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
  if (room.status === 'done') {
    return NextResponse.json({ error: 'Reel already done' }, { status: 409 })
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

  await supabase
    .from('rooms')
    .update({ status: 'generating', music_genre: music_name ?? music_url })
    .eq('id', room.id)

  return NextResponse.json({ photos: photoItems, async: false })
}

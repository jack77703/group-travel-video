import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { storage_path } = await request.json()
  if (!storage_path) {
    return NextResponse.json({ error: 'Missing storage_path' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, created_by_token')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.created_by_token !== initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storage_path)
  const mp4_url = urlData.publicUrl

  const { error: reelError } = await supabase
    .from('reels')
    .upsert(
      { room_id: room.id, mp4_url, status: 'done', render_id: null },
      { onConflict: 'room_id' }
    )

  if (reelError) {
    console.error('[reel/complete] upsert error:', reelError)
    return NextResponse.json({ error: 'Failed to save reel' }, { status: 500 })
  }

  await supabase.from('rooms').update({ status: 'done' }).eq('id', room.id)

  return NextResponse.json({ ok: true })
}

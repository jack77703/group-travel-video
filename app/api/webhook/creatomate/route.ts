import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  console.log('[webhook] payload:', JSON.stringify(body))
  const { id: render_id, status, url } = body

  if (!render_id || !status) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: reel, error: reelError } = await supabase
    .from('reels')
    .select('id, room_id')
    .eq('render_id', render_id)
    .single()

  console.log('[webhook] render_id:', render_id, 'reel:', JSON.stringify(reel), 'error:', JSON.stringify(reelError))

  if (!reel) {
    return NextResponse.json({ ok: true })
  }

  if (status === 'succeeded') {
    await supabase
      .from('reels')
      .update({ status: 'done', mp4_url: url })
      .eq('id', reel.id)
    await supabase
      .from('rooms')
      .update({ status: 'done' })
      .eq('id', reel.room_id)
  } else if (status === 'failed') {
    await supabase
      .from('reels')
      .update({ status: 'failed' })
      .eq('id', reel.id)
    await supabase
      .from('rooms')
      .update({ status: 'open' })
      .eq('id', reel.room_id)
  }

  return NextResponse.json({ ok: true })
}

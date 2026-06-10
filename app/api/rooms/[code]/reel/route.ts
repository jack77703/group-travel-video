import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: reel } = await supabase
    .from('reels')
    .select('status, mp4_url')
    .eq('room_id', room.id)
    .single()

  if (!reel) {
    return NextResponse.json({ status: 'not_started' })
  }

  return NextResponse.json({ status: reel.status, mp4_url: reel.mp4_url })
}

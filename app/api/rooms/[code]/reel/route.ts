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
    .select('id, status')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: reel } = await supabase
    .from('reels')
    .select('status, mp4_url')
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reel) {
    return NextResponse.json({ room_status: room.status, status: 'not_started', mp4_url: null })
  }

  return NextResponse.json({ room_status: room.status, status: reel.status, mp4_url: reel.mp4_url })
}

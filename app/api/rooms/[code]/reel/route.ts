import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const STUCK_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

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
    .select('status, mp4_url, created_at')
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reel) {
    return NextResponse.json({ room_status: room.status, status: 'not_started', mp4_url: null })
  }

  // Auto-recover rooms stuck in 'generating' for more than 15 minutes.
  // The client-side FFmpeg encoder runs in the browser — if the tab closes or
  // the network drops mid-upload, the room never transitions back to 'open'.
  // This turns a manual support request into a self-healing retry.
  if (room.status === 'generating' && reel.status !== 'done') {
    const ageMs = Date.now() - new Date(reel.created_at).getTime()
    if (ageMs > STUCK_TIMEOUT_MS) {
      await supabase.from('rooms').update({ status: 'open' }).eq('id', room.id)
      return NextResponse.json({ room_status: 'open', status: 'failed', mp4_url: null })
    }
  }

  return NextResponse.json({ room_status: room.status, status: reel.status, mp4_url: reel.mp4_url })
}

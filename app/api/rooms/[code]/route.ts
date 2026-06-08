import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  const supabase = createServerClient()

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, code, name, occasion, status, max_photos_per_member')
    .eq('code', params.code.toUpperCase())
    .single()

  if (error || !room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: members } = await supabase
    .from('members')
    .select('id, name, photos_uploaded')
    .eq('room_id', room.id)
    .order('joined_at', { ascending: true })

  return NextResponse.json({ ...room, members: members ?? [] })
}

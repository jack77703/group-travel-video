import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const { name } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, max_photos_per_member')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.status !== 'open') {
    return NextResponse.json({ error: 'Room is no longer accepting members' }, { status: 409 })
  }

  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('room_id', room.id)
    .ilike('name', name.trim())
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Name already taken in this room' }, { status: 409 })
  }

  const session_token = crypto.randomUUID()
  const session_token_expires_at = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data: member, error } = await supabase
    .from('members')
    .insert({ room_id: room.id, name: name.trim(), session_token, session_token_expires_at })
    .select()
    .single()

  if (error || !member) {
    return NextResponse.json({ error: 'Failed to join room' }, { status: 500 })
  }

  return NextResponse.json({
    member_id: member.id,
    session_token,
    name: member.name,
    max_photos_per_member: room.max_photos_per_member,
  })
}

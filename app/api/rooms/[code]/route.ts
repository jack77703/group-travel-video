import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  const supabase = createServerClient()

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, code, name, status, max_photos_per_member')
    .eq('code', params.code.toUpperCase())
    .single()

  if (error || !room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: members } = await supabase
    .from('members')
    .select('id, name, is_initiator')
    .eq('room_id', room.id)
    .order('name', { ascending: true })

  const { data: photoCounts } = await supabase
    .from('photos')
    .select('member_id')
    .eq('room_id', room.id)

  const countByMember: Record<string, number> = {}
  for (const p of photoCounts ?? []) {
    countByMember[p.member_id] = (countByMember[p.member_id] ?? 0) + 1
  }

  const sorted = (members ?? [])
    .map(m => ({ ...m, photos_uploaded: countByMember[m.id] ?? 0 }))
    .sort((a, b) => {
      if (a.is_initiator !== b.is_initiator) return a.is_initiator ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return NextResponse.json({ ...room, members: sorted })
}

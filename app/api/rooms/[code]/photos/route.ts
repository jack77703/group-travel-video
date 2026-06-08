import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const session_token = request.headers.get('x-session-token')
  const { file_name, file_type } = await request.json()

  if (!session_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!file_name || !file_type?.startsWith('image/')) {
    return NextResponse.json({ error: 'Valid image file is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: member } = await supabase
    .from('members')
    .select('id, room_id, photos_uploaded, session_token_expires_at')
    .eq('session_token', session_token)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }
  if (new Date(member.session_token_expires_at) < new Date()) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, max_photos_per_member')
    .eq('id', member.room_id)
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room || room.status !== 'open') {
    return NextResponse.json({ error: 'Room not found or closed' }, { status: 404 })
  }
  if (member.photos_uploaded >= room.max_photos_per_member) {
    return NextResponse.json({ error: 'Photo limit reached' }, { status: 409 })
  }

  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', member.id)

  const display_order = (count ?? 0) + 1
  const storage_path = `${room.id}/${member.id}/${Date.now()}_${file_name}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('photos')
    .createSignedUploadUrl(storage_path)

  if (uploadError || !uploadData) {
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
  }

  const { error: photoInsertError } = await supabase.from('photos').insert({
    room_id: room.id,
    member_id: member.id,
    storage_path,
    display_order,
  })

  if (photoInsertError) {
    console.error('Photo insert error:', photoInsertError)
    return NextResponse.json({ error: 'Failed to record photo' }, { status: 500 })
  }

  const { error: memberUpdateError } = await supabase
    .from('members')
    .update({ photos_uploaded: member.photos_uploaded + 1 })
    .eq('id', member.id)

  if (memberUpdateError) {
    console.error('Member update error:', memberUpdateError)
  }

  return NextResponse.json({ upload_url: uploadData.signedUrl, path: storage_path })
}

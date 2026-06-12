import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const path = `${room.id}/${Date.now()}.mp4`
  const { data, error } = await supabase.storage
    .from('videos')
    .createSignedUploadUrl(path)

  if (error || !data) {
    console.error('[upload-url] signed upload URL error:', error)
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: data.signedUrl, path })
}

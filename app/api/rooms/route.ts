import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'
import { getIp, rateLimit } from '@/lib/rate-limit'

function generateRoomCode(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

export async function POST(request: NextRequest) {
  if (!rateLimit(getIp(request), 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many rooms created. Try again later.' }, { status: 429 })
  }

  const body = await request.json()
  const { name, max_photos_per_member } = body

  if (!name || !max_photos_per_member) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (max_photos_per_member < 1 || max_photos_per_member > 10) {
    return NextResponse.json({ error: 'max_photos_per_member must be 1-10' }, { status: 400 })
  }

  const supabase = createServerClient()
  const created_by_token = crypto.randomUUID()
  let code = generateRoomCode()

  for (let i = 0; i < 5; i++) {
    const { data: existing } = await supabase.from('rooms').select('id').eq('code', code).single()
    if (!existing) break
    code = generateRoomCode()
  }

  const { data, error } = await supabase
    .from('rooms')
    .insert({ name, max_photos_per_member, code, created_by_token })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }

  return NextResponse.json({
    code: data.code,
    created_by_token,
    share_url: `${process.env.NEXT_PUBLIC_APP_URL}/room/${data.code}`,
  })
}

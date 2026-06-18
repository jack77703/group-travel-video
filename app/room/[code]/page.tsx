import type { Metadata } from 'next'

import { createServerClient } from '@/lib/supabase-server'
import JoinClient from './JoinClient'

export async function generateMetadata(
  { params }: { params: { code: string } }
): Promise<Metadata> {
  const supabase = createServerClient()
  const code = params.code.toUpperCase()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('code', code)
    .single()

  if (!room) return { title: 'Reveel' }

  const { count: memberCount } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', room.id)

  const count = memberCount ?? 0
  const description = count > 0
    ? `${count} ${count === 1 ? 'person is' : 'people are'} already adding photos. Join to be in the reel.`
    : 'Upload your photos secretly. Everyone gets surprised at the reveal.'

  const title = `Join ${room.name} on Reveel`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: '/og-default.jpg', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default function JoinPage({ params }: { params: { code: string } }) {
  return <JoinClient code={params.code.toUpperCase()} />
}

import type { Metadata } from 'next'

import { createServerClient } from '@/lib/supabase-server'
import ShareClient from './ShareClient'

export async function generateMetadata(
  { params }: { params: { code: string } }
): Promise<Metadata> {
  const supabase = createServerClient()
  const code = params.code.toUpperCase()

  const { data: room } = await supabase
    .from('rooms')
    .select('name')
    .eq('code', code)
    .single()

  if (!room) return { title: 'Reveel' }

  const title = `${room.name} — Watch our travel reel`
  const description = 'Made with Reveel. Create your own group travel video in minutes.'

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

export default function SharePage({ params }: { params: { code: string } }) {
  return <ShareClient code={params.code.toUpperCase()} />
}

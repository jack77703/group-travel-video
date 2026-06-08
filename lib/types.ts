export interface Room {
  id: string
  code: string
  name: string
  occasion: string
  status: 'open' | 'generating' | 'done'
  max_photos_per_member: number
  music_genre: string | null
  created_by_token: string
  created_at: string
}

export interface Member {
  id: string
  room_id: string
  name: string
  session_token: string
  session_token_expires_at: string
  photos_uploaded: number
  joined_at: string
}

export interface Photo {
  id: string
  room_id: string
  member_id: string
  storage_path: string
  display_order: number
  uploaded_at: string
}

export interface Reel {
  id: string
  room_id: string
  render_id: string | null
  mp4_url: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
  created_at: string
}

export interface MemberPublic {
  id: string
  name: string
  photos_uploaded: number
}

export interface RoomPublic {
  id: string
  code: string
  name: string
  occasion: string
  status: Room['status']
  max_photos_per_member: number
  members: MemberPublic[]
}

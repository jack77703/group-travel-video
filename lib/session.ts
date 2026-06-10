const KEY = 'reel_session'

export interface Session {
  token: string
  roomCode: string
  memberId: string
  memberName: string
  roomName: string
}

export function getSession(roomCode: string): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`${KEY}_${roomCode}`)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function setSession(roomCode: string, session: Session): void {
  localStorage.setItem(`${KEY}_${roomCode}`, JSON.stringify(session))
}

export function getInitiatorToken(roomCode: string): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(`${KEY}_${roomCode}_initiator`)
}

export function setInitiatorToken(roomCode: string, token: string): void {
  localStorage.setItem(`${KEY}_${roomCode}_initiator`, token)
}

export function removeSession(roomCode: string): void {
  localStorage.removeItem(`${KEY}_${roomCode}`)
  localStorage.removeItem(`${KEY}_${roomCode}_initiator`)
}

export function listSessions(): Session[] {
  if (typeof window === 'undefined') return []
  try {
    const sessions: Session[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${KEY}_`) && !key.endsWith('_initiator')) {
        const raw = localStorage.getItem(key)
        if (raw) sessions.push(JSON.parse(raw) as Session)
      }
    }
    return sessions
  } catch {
    return []
  }
}

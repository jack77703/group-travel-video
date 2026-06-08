export const MUSIC_GENRES = {
  upbeat: {
    label: 'Upbeat',
    description: 'Energetic and fun',
    url: 'https://cdn.pixabay.com/audio/2024/03/04/audio_d1b5d81a6e.mp3',
  },
  cinematic: {
    label: 'Cinematic',
    description: 'Epic and emotional',
    url: 'https://cdn.pixabay.com/audio/2023/10/30/audio_b09c0a1234.mp3',
  },
  chill: {
    label: 'Chill',
    description: 'Relaxed and dreamy',
    url: 'https://cdn.pixabay.com/audio/2024/01/15/audio_a1b2c3d4e5.mp3',
  },
} as const

export type MusicGenre = keyof typeof MUSIC_GENRES

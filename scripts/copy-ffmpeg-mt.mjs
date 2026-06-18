import { copyFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src  = join(root, 'node_modules/@ffmpeg/core-mt/dist/umd')
const dest = join(root, 'public/ffmpeg-mt')

mkdirSync(dest, { recursive: true })

for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']) {
  copyFileSync(join(src, file), join(dest, file))
  console.log(`Copied ${file}`)
}

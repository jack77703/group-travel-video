import { FFmpeg } from '@ffmpeg/ffmpeg'

import type { CoreBlobs } from './ffmpeg-renderer'

// Each FFmpeg instance runs in its own Web Worker internally (@ffmpeg/ffmpeg design).
// Spawning N instances = N parallel WASM threads at the OS level.
// We cap at 4 and use half the reported cores so we don't starve the main thread
// or exhaust ~100 MB × N memory on mobile.
function poolSize(): number {
  if (typeof navigator === 'undefined') return 2
  return Math.min(4, Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)))
}

export class FFmpegPool {
  private instances: FFmpeg[] = []
  // Tail of each instance's promise chain — ensures one exec at a time per instance
  // while different instances run in parallel.
  private tails: Promise<void>[] = []

  async load(blobs: CoreBlobs): Promise<void> {
    const n = poolSize()
    this.instances = Array.from({ length: n }, () => new FFmpeg())
    this.tails = this.instances.map(() => Promise.resolve())
    const opts = blobs.workerURL
      ? { coreURL: blobs.coreURL, wasmURL: blobs.wasmURL, workerURL: blobs.workerURL }
      : { coreURL: blobs.coreURL, wasmURL: blobs.wasmURL }
    await Promise.all(this.instances.map(ff => ff.load(opts)))
  }

  // Dispatch a task to instance[index % poolSize]. Tasks on the same instance
  // are serialized; tasks on different instances run in parallel.
  enqueue<T>(index: number, task: (ff: FFmpeg) => Promise<T>): Promise<T> {
    const slot = index % this.instances.length
    const ff = this.instances[slot]
    const result: Promise<T> = this.tails[slot].then(() => task(ff))
    this.tails[slot] = result.then(() => {}, () => {})
    return result
  }

  terminateAll(): void {
    this.instances.forEach(ff => ff.terminate())
    this.instances = []
    this.tails = []
  }
}

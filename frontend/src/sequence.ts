import type { MotionOptions, Pose } from './clips'

export type TimedClip = { clip_id: string; start_ms: number; end_ms: number }
type Sampler = (id: string, seconds: number, opts?: MotionOptions) => Pose
type Blender = (a: Pose, b: Pose, weight: number) => Pose

/** Shared by planned playback and a phrase opened directly in the library.
 * Only the first/last sign uses rest. The next sign is formed at its actual
 * articulation start, so a boundary cannot erase chin/brow contact. */
export function sampleSequence(clips: readonly TimedClip[], at: number, sample: Sampler,
  blend: Blender, mode: MotionOptions['mode'] = 'continuous'): Pose {
  const index = clips.findIndex(c => at >= c.start_ms && at < c.end_ms)
  if (index < 0) return sample('idle', 0)
  const clip = clips[index], previous = clips[index - 1], next = clips[index + 1]
  const joinsPrevious = previous?.end_ms === clip.start_ms
  const joinsNext = next?.start_ms === clip.end_ms
  const duration = clip.end_ms - clip.start_ms
  const local = at - clip.start_ms
  const pose = sample(clip.clip_id, local / 1000, {
    mode, durationMs: duration, skipOnset: joinsPrevious, skipRelease: joinsNext,
  })
  const transition = Math.min(180, duration * 0.18)
  if (!joinsNext || local < duration - transition) return pose
  const incoming = sample(next.clip_id, 0, {
    mode, durationMs: next.end_ms - next.start_ms, skipOnset: true,
  })
  const t = (local - (duration - transition)) / transition
  return blend(pose, incoming, t * t * t * (t * (t * 6 - 15) + 10))
}

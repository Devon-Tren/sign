import { blendPoses, motionFor, type Pose } from './clips'
import type { PlaybackTimeline } from './types'

const COARTICULATION_MS = 220
const smoothstep = (value:number) => value * value * (3 - 2 * value)

/** Milliseconds, half-open intervals; backend anchor spans become continuous time. */
export function poseAt(timeline: PlaybackTimeline, elapsedMs: number): Pose {
  const index = timeline.clips.findIndex(c => elapsedMs >= c.start_ms && elapsedMs < c.end_ms)
  const clip = index >= 0 ? timeline.clips[index] : undefined
  const localMs = clip ? elapsedMs - clip.start_ms : 0
  let pose = clip ? motionFor(clip.clip_id, localMs / 1000) : motionFor('idle', 0)
  // Preserve the outgoing articulation briefly while the next handshape and
  // arm target form. This approximates coarticulation and removes the visible
  // pose reset that made a multi-sign plan look like a slideshow.
  if (clip && index > 0 && localMs < COARTICULATION_MS) {
    const previous = timeline.clips[index - 1]
    const previousDuration = previous.end_ms - previous.start_ms
    const outgoing = motionFor(previous.clip_id, previousDuration * .80 / 1000)
    const incoming = motionFor(clip.clip_id, Math.max(localMs, (clip.end_ms - clip.start_ms) * .12) / 1000)
    pose = blendPoses(outgoing, incoming, smoothstep(localMs / COARTICULATION_MS))
  }
  const expression = timeline.nonmanuals.find(s => elapsedMs >= s.start_ms && elapsedMs < s.end_ms)
  if (!expression) return pose
  // The timeline still carries a single `brow` control, but Pose now splits it
  // into browRaise (yes/no questions) and browFurrow (WH-questions). Map a
  // positive value onto the raise and a negative one onto the furrow rather
  // than dropping the expression silently.
  const { brow, ...rest } = expression.controls
  return {
    ...pose,
    ...rest,
    browRaise: brow > 0 ? brow : 0,
    browFurrow: brow < 0 ? -brow : 0,
  }
}

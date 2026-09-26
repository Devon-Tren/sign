import { motionFor, type Pose } from './clips'
import type { PlaybackTimeline } from './types'

/** Milliseconds, half-open intervals; backend anchor spans become continuous time. */
export function poseAt(timeline: PlaybackTimeline, elapsedMs: number): Pose {
  const clip = timeline.clips.find(c => elapsedMs >= c.start_ms && elapsedMs < c.end_ms)
  const pose = clip ? motionFor(clip.clip_id, (elapsedMs - clip.start_ms) / 1000) : motionFor('idle', 0)
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

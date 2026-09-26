import { blendPoses, motionFor, type Pose } from './clips'
import type { PlaybackTimeline } from './types'
import { sampleSequence } from './sequence'

/**
 * A planned timeline is CONNECTED signing, not isolated display. The two have
 * measurably different tempos - see the timing note in ./clips - so the clip
 * length the timeline allocates is passed through explicitly rather than
 * letting motionFor fall back to its isolated-display schedule and disagree
 * with the timeline about how long the sign lasts.
 */
/** Milliseconds, half-open intervals; backend anchor spans become continuous time. */
export function poseAt(timeline: PlaybackTimeline, elapsedMs: number): Pose {
  const pose = sampleSequence(timeline.clips, elapsedMs, motionFor, blendPoses)
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

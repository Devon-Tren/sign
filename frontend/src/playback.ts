import { blendPoses, motionFor, type MotionOptions, type Pose } from './clips'
import type { PlaybackTimeline } from './types'

/**
 * A planned timeline is CONNECTED signing, not isolated display. The two have
 * measurably different tempos - see the timing note in ./clips - so the clip
 * length the timeline allocates is passed through explicitly rather than
 * letting motionFor fall back to its isolated-display schedule and disagree
 * with the timeline about how long the sign lasts.
 */
const continuous = (durationMs: number): MotionOptions =>
  ({ mode: 'continuous', durationMs: Math.max(1, Math.round(durationMs)) })

const COARTICULATION_MS = 240
const smootherstep = (value:number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Milliseconds, half-open intervals; backend anchor spans become continuous time. */
export function poseAt(timeline: PlaybackTimeline, elapsedMs: number): Pose {
  const index = timeline.clips.findIndex(c => elapsedMs >= c.start_ms && elapsedMs < c.end_ms)
  const clip = index >= 0 ? timeline.clips[index] : undefined
  const localMs = clip ? elapsedMs - clip.start_ms : 0
  const duration = clip ? clip.end_ms - clip.start_ms : 0
  // Middle clips start just after their isolated onset. The previous clip has
  // already formed this handshape during the pre-boundary transition, so
  // replaying the neutral onset would create a visible dip at every boundary.
  const sampleMs = clip && index > 0 ? Math.max(localMs, duration * .12) : localMs
  let pose = clip
    ? motionFor(clip.clip_id, sampleMs / 1000, continuous(duration))
    : motionFor('idle', 0)

  // Blend BEFORE the boundary. The old implementation let the outgoing clip
  // release to idle, then jumped back to its articulated pose after crossing
  // the boundary—a discontinuity disguised as “coarticulation”. Holding the
  // outgoing stroke and forming the next handshape produces one continuous
  // movement and preserves the final clip's natural release to neutral.
  const next = clip && index + 1 < timeline.clips.length ? timeline.clips[index + 1] : undefined
  if (clip && next && localMs >= duration - COARTICULATION_MS) {
    const nextDuration = next.end_ms - next.start_ms
    const outgoing = motionFor(clip.clip_id, duration * .80 / 1000, continuous(duration))
    const incoming = motionFor(next.clip_id, nextDuration * .12 / 1000, continuous(nextDuration))
    pose = blendPoses(outgoing, incoming,
      smootherstep((localMs - (duration - COARTICULATION_MS)) / COARTICULATION_MS))
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

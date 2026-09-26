import { bridgePoses, clipLengthMs, minimumClipMs, motionFor, type Pose } from './clips'
import { authoredSequenceFor } from './authored'
import type { PlaybackTimeline } from './types'
import { retime, sampleSequence } from './sequence'

/**
 * A planned timeline is CONNECTED signing, not isolated display. The two have
 * measurably different tempos - see the timing note in ./clips - so the clip
 * length the timeline allocates is passed through explicitly rather than
 * letting motionFor fall back to its isolated-display schedule and disagree
 * with the timeline about how long the sign lasts.
 *
 * Every timeline is played through retime(): the planner's clip windows plus
 * scheduled, velocity-bounded transitions (./sequence). Callers that need the
 * played duration or clip boundaries must use playbackPlan(), not the raw
 * planner timeline, or they will disagree with what is on screen.
 */
export function playbackPlan(timeline: PlaybackTimeline): PlaybackTimeline {
  return retime(timeline, motionFor, minimumClipMs)
}

/** Milliseconds into the PLAYED plan (see playbackPlan). */
export function poseAt(timeline: PlaybackTimeline, elapsedMs: number): Pose {
  const plan = playbackPlan(timeline)
  // In a retimed plan the blender is only used for the transitions between clips.
  const pose = sampleSequence(plan.clips, elapsedMs, motionFor, bridgePoses, 'continuous',
    { durationMs: plan.duration_ms })
  const expression = plan.nonmanuals.find(s => elapsedMs >= s.start_ms && elapsedMs < s.end_ms)
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

/** One sign on its own (library preview) as a plan, so it gets the same
 *  scheduled lead-in and lead-out as connected signing. An authored compound
 *  (GOOD MORNING) is expanded into its parts, as the backend does, so the
 *  move between them is a scheduled transition rather than a fixed blend. */
export function singleSignPlan(clipId: string, durationMs: number): PlaybackTimeline {
  const parts = authoredSequenceFor(clipId)?.clips
  let offset = 0
  const clips = (parts ?? [clipId]).map((id, i) => {
    const length = parts ? clipLengthMs(id, 'isolated') : durationMs
    const clip = { anchor: `a${i + 1}`, sign_id: id.toUpperCase(), clip_id: id, start_ms: offset,
      end_ms: offset + length, realization: 'preview' }
    offset += length
    return clip
  })
  return playbackPlan({ version: 2, renderer: 'sign-procedural-v2', duration_ms: offset, nonmanuals: [], clips })
}

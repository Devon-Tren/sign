import type { MotionOptions, Pose } from './clips'
import type { PlaybackTimeline } from './types'
import { bridgeArc, bridgeClearance } from './orient'

export type TimedClip = { clip_id: string; start_ms: number; end_ms: number }
type Sampler = (id: string, seconds: number, opts?: MotionOptions) => Pose
type Blender = (a: Pose, b: Pose, weight: number) => Pose

/**
 * Transitions get their own time.
 *
 * The planner allocates each sign a window and nothing for getting there, so
 * the move from rest, between signs and back to rest was squeezed into ~170 ms
 * inside the sign itself. Measured over real sentences, EVERY frame above
 * 3.2 arm-reach/s fell within 200 ms of a sign boundary, peaking at 7-13
 * reach/s (4-7 m/s) with palms turning ~26 rad/s - several times faster than
 * a human hand. Three smoothing filters were stacked on the rig to hide that,
 * which is why the avatar ran 100-117 ms behind every path and missed contacts.
 *
 * Here a transition is scheduled between every pair of poses, long enough that
 * a minimum-jerk move peaks at TRANSITION_PEAK_SPEED (~1.8 m/s, fluent but
 * human) and TRANSITION_PEAK_TURN. The sign keeps its whole window.
 */
export const TRANSITION_PEAK_SPEED = 3.2
export const TRANSITION_PEAK_TURN = 16
/** Peak-to-average velocity ratio of a minimum-jerk profile. */
const MIN_JERK_PEAK = 1.875
const TRANSITION_MIN_MS = 140
const TRANSITION_MAX_MS = 900
/** Share of the adjacent travel taken out of a sign's hold, and the most a window may shrink. */
const HOLD_SHARE_OF_TRAVEL = 0.3
const MAX_HOLD_SHARE = 0.4

export const minJerk = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Time for a minimum-jerk move between two poses to stay within human speed. */
export function transitionMs(from: Pose, to: Pose): number {
  let travel = 0, turn = 0
  for (const side of ['rightArm', 'leftArm'] as const) {
    const a = from[side], b = to[side]
    if (!a || !b) continue
    // A minimum-jerk line peaks at 1.875x average speed; the forward arc's
    // sine bump adds up to pi x its depth. Budget for both.
    travel = Math.max(travel, dist(a.target, b.target) + Math.PI / MIN_JERK_PEAK * bridgeClearance(a.target, b.target))
    // The rotation the transition will actually perform (possibly the long
    // way round, see ./orient bridgeArc), not the smaller palm/point angles.
    turn = Math.max(turn, bridgeArc(a.palm, a.point, b.palm, b.point, side === 'rightArm' ? 1 : -1, a.target, b.target).angle)
  }
  const seconds = MIN_JERK_PEAK * Math.max(travel / TRANSITION_PEAK_SPEED, turn / TRANSITION_PEAK_TURN)
  return Math.round(Math.min(TRANSITION_MAX_MS, Math.max(TRANSITION_MIN_MS, seconds * 1000)))
}

const bridged = { skipOnset: true, skipRelease: true } as const
const startPose = (clip: TimedClip, sample: Sampler, mode: MotionOptions['mode']) =>
  sample(clip.clip_id, 0, { mode, durationMs: clip.end_ms - clip.start_ms, ...bridged })
/** 1 ms before the end: clip time wraps modulo its length. */
const endPose = (clip: TimedClip, sample: Sampler, mode: MotionOptions['mode']) =>
  sample(clip.clip_id, Math.max(0, clip.end_ms - clip.start_ms - 1) / 1000,
    { mode, durationMs: clip.end_ms - clip.start_ms, ...bridged })

const RETIMED = new WeakSet<PlaybackTimeline>()
const retimeCache = new WeakMap<PlaybackTimeline, PlaybackTimeline>()
export const isRetimed = (timeline: PlaybackTimeline) => RETIMED.has(timeline)

/**
 * Insert velocity-bounded transitions before, between and after the planned
 * clips. Clip durations are kept; expression spans move with their clips.
 * Idempotent and cached per timeline object.
 */
export function retime(timeline: PlaybackTimeline, sample: Sampler,
  minimumMs: (clipId: string) => number = () => 0): PlaybackTimeline {
  if (RETIMED.has(timeline)) return timeline
  const cached = retimeCache.get(timeline)
  if (cached) return cached
  const idle = sample('idle', 0)
  // Pass 1: the travel each boundary needs (start/end poses do not depend on
  // the window length). The planner's windows come from citation durations,
  // which already include moving in and out of the sign, so pass 2 takes part
  // of the new travel out of each sign's hold instead of adding it all on
  // top (playback had grown to ~1.7x the planned length).
  const n = timeline.clips.length
  const lengths = timeline.clips.map(c => Math.max(c.end_ms - c.start_ms, minimumMs(c.clip_id)))
  const travel: number[] = []
  let previous = idle
  timeline.clips.forEach((clip, i) => {
    const planned = i > 0 ? clip.start_ms - timeline.clips[i - 1].end_ms : 0
    travel.push(Math.max(transitionMs(previous,
      startPose({ ...clip, start_ms: 0, end_ms: lengths[i] }, sample, 'continuous')), planned))
    previous = endPose({ ...clip, start_ms: 0, end_ms: lengths[i] }, sample, 'continuous')
  })
  travel.push(n ? transitionMs(previous, idle) : 0)
  const clips: PlaybackTimeline['clips'] = []
  let offset = 0
  timeline.clips.forEach((clip, i) => {
    const planned = lengths[i]
    const floor = Math.max(planned * (1 - MAX_HOLD_SHARE), minimumMs(clip.clip_id))
    const length = Math.round(Math.max(floor, planned - HOLD_SHARE_OF_TRAVEL * (travel[i] + travel[i + 1])))
    offset += travel[i]
    clips.push({ ...clip, start_ms: offset, end_ms: offset + length })
    offset += length
  })
  const duration = offset + travel[n]
  // Spans reference the planner's clip boundaries; re-anchor them by index.
  const nonmanuals = timeline.nonmanuals.map(span => {
    const first = timeline.clips.findIndex(c => c.end_ms > span.start_ms)
    let last = -1
    timeline.clips.forEach((c, i) => { if (c.start_ms < span.end_ms) last = i })
    if (first < 0 || last < first) return span
    return { ...span, start_ms: clips[first].start_ms, end_ms: clips[last].end_ms }
  })
  const out: PlaybackTimeline = { ...timeline, duration_ms: duration, clips, nonmanuals }
  RETIMED.add(out)
  retimeCache.set(timeline, out)
  return out
}

/**
 * Sample a sequence at `at` ms.
 *
 * With `bridge`, the clips were laid out by retime(): every sign plays its
 * whole window and the gaps are minimum-jerk transitions from the previous
 * sign's final pose (or rest) to the next sign's first pose (or rest).
 * Without it (an authored compound played as one clip) contiguous clips
 * cross-blend over their last 180 ms as before.
 */
export function sampleSequence(clips: readonly TimedClip[], at: number, sample: Sampler,
  blend: Blender, mode: MotionOptions['mode'] = 'continuous', bridge?: { durationMs: number }): Pose {
  const index = clips.findIndex(c => at >= c.start_ms && at < c.end_ms)
  if (bridge) {
    if (index >= 0) {
      const clip = clips[index]
      return sample(clip.clip_id, (at - clip.start_ms) / 1000,
        { mode, durationMs: clip.end_ms - clip.start_ms, ...bridged })
    }
    const nextIndex = clips.findIndex(c => c.start_ms > at)
    const prev = nextIndex < 0 ? clips[clips.length - 1] : clips[nextIndex - 1]
    const next = nextIndex < 0 ? undefined : clips[nextIndex]
    const idle = sample('idle', at / 1000)
    const from = prev ? endPose(prev, sample, mode) : idle
    const to = next ? startPose(next, sample, mode) : idle
    const a = prev ? prev.end_ms : 0
    const b = next ? next.start_ms : bridge.durationMs
    if (b <= a || at >= b) return to
    return blend(from, to, minJerk(Math.max(0, (at - a) / (b - a))))
  }
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
  return blend(pose, incoming, minJerk(t))
}

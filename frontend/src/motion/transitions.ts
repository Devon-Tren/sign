import { augmentFor, blendPoses, type Pose, type Vec3 } from '../clips'
import { resolvedMotionFor, resolveSign } from './resolver'
import type { PlaybackTimeline } from '../types'
import { defaultPhases, smoothstep } from './phases'

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]))
export function transitionDuration(a: Pose, b: Pose, speed = 1, availableMs = 1000): number {
  let travel = 0, contact = false, activity = false
  for (const side of ['rightArm', 'leftArm'] as const) {
    const from = a[side], to = b[side]
    activity ||= Boolean(from) !== Boolean(to) || Boolean(from && to && (from.target[1] < -.65) !== (to.target[1] < -.65))
    if (from && to) travel = Math.max(travel, distance(from.target, to.target))
    contact ||= Boolean(from?.contact || to?.contact)
  }
  // Timeline milliseconds. The avatar clock applies speed once.
  return Math.min(availableMs * .42, Math.max(100, Math.min(360,
    (110 + travel * 180 + (contact ? 35 : 0) + (activity ? 35 : 0)) * Math.sqrt(Math.max(.25, speed)))))
}
type Transition = { start: number; end: number; from: Pose; to: Pose; before: Pose; after: Pose; entryMs: number; exitMs: number; duration: number }
const cache = new WeakMap<PlaybackTimeline, Map<number, Transition[]>>()
export function transitionsFor(timeline: PlaybackTimeline, speed = 1): Transition[] {
  let speeds = cache.get(timeline)
  if (!speeds) { speeds = new Map(); cache.set(timeline, speeds) }
  const found = speeds.get(speed)
  if (found) return found
  const transitions = timeline.clips.slice(0, -1).map((clip, i) => {
    const next = timeline.clips[i + 1], duration = clip.end_ms - clip.start_ms, nextDuration = next.end_ms - next.start_ms
    const sample = (id: string, ms: number, length: number) => resolvedMotionFor(id, ms / 1000, { durationMs: length, mode: 'continuous' })
    const nextPhases = resolveSign(next.clip_id).curated?.phases ?? augmentFor(next.clip_id).phases ?? defaultPhases(nextDuration)
    const currentPhases = resolveSign(clip.clip_id).curated?.phases ?? augmentFor(clip.clip_id).phases ?? defaultPhases(duration)
    const entryMs = next.clip_id.startsWith('fs:') ? 0 : nextPhases[0] * nextDuration
    const to = sample(next.clip_id, entryMs, nextDuration)
    const window = transitionDuration(sample(clip.clip_id, duration * .7, duration), to, speed, duration)
    const start = duration - window
    // Never let a short transition begin after retraction to neutral has
    // started. Retiming the preceding stroke preserves the active endpoint.
    const exitMs = clip.clip_id.startsWith('fs:') ? start : Math.min(start, currentPhases[2] * duration)
    const from = sample(clip.clip_id, exitMs, duration)
    return { start: clip.start_ms + start, end: clip.end_ms, from, to,
      before: sample(clip.clip_id, Math.max(0, exitMs - 20), duration),
      after: sample(next.clip_id, entryMs + 20, nextDuration), entryMs, exitMs, duration: window }
  })
  speeds.set(speed, transitions)
  return transitions
}
function hermite(a: Vec3, b: Vec3, before: Vec3, after: Vec3, t: number, duration: number): Vec3 {
  const t2 = t*t, t3 = t2*t
  return a.map((v, i) => {
    const bound = Math.max(.015, Math.abs(b[i] - v) * .75)
    const tangent = (delta: number) => Math.max(-bound, Math.min(bound, delta * duration / 20))
    return (2*t3-3*t2+1)*v + (t3-2*t2+t)*tangent(v-before[i]) + (-2*t3+3*t2)*b[i] + (t3-t2)*tangent(after[i]-b[i])
  }) as unknown as Vec3
}
export function transitionPose(transition: Transition, ms: number): Pose {
  const t = Math.max(0, Math.min(1, (ms - transition.start) / transition.duration))
  const pose = blendPoses(transition.from, transition.to, smoothstep(t))
  for (const side of ['rightArm', 'leftArm'] as const) {
    const a=transition.from[side], b=transition.to[side], before=transition.before[side], after=transition.after[side]
    if (a && b && before && after && pose[side]) pose[side] = { ...pose[side]!, target: hermite(a.target,b.target,before.target,after.target,t,transition.duration) }
  }
  return pose
}

import { motionFor, type Pose } from './clips'
import type { PlaybackTimeline } from './types'
import { curated, sampleCurated } from './motion/curated'
import { resolvedMotionFor, resolveTimeline } from './motion/resolver'
import { transitionsFor, transitionPose } from './motion/transitions'
import { applyNonmanuals, spanWeight } from './motion/nonmanuals'

export function clipSampleMs(timeline: PlaybackTimeline, index: number, local: number, speed = 1) {
  const clip = timeline.clips[index], duration = clip.end_ms - clip.start_ms
  const transitions = transitionsFor(timeline, speed)
  const entry = index > 0 ? transitions[index - 1].entryMs : 0
  const end = transitions[index] ? transitions[index].start - clip.start_ms : duration
  const exit = transitions[index]?.exitMs ?? duration
  return entry + local * (exit - entry) / end
}

/** Shared sampler for the avatar, inspector, tests and offline plans. */
export function poseAt(input: PlaybackTimeline, elapsedMs: number, speed = 1): Pose {
  const timeline = resolveTimeline(input)
  const index = timeline.clips.findIndex(c => elapsedMs >= c.start_ms && elapsedMs < c.end_ms)
  if (index < 0) return motionFor('idle', 0)
  let pose: Pose
  const phrase = timeline.curated_phrase && curated.phrases[timeline.curated_phrase]
  if (phrase) pose = sampleCurated(phrase, elapsedMs / timeline.duration_ms)
  else {
    const clip = timeline.clips[index], duration = clip.end_ms - clip.start_ms
    const local = elapsedMs - clip.start_ms
    const transitions = transitionsFor(timeline, speed)
    const outgoing = transitions[index]
    // Start at the previous transition's endpoint, then resume the stroke.
    const sample = clipSampleMs(timeline, index, local, speed)
    pose = outgoing && elapsedMs >= outgoing.start ? transitionPose(outgoing, elapsedMs)
      : resolvedMotionFor(clip.clip_id, sample / 1000, { durationMs: duration, mode: 'continuous' })
  }
  for (const span of timeline.nonmanuals) if (elapsedMs >= span.start_ms && elapsedMs < span.end_ms)
    pose = applyNonmanuals(pose, span.controls, spanWeight(elapsedMs, span.start_ms, span.end_ms))
  return pose
}

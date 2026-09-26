import { clipLengthMs, isParameterised, motionFor, type MotionOptions } from '../clips'
import { canonicalId, curatedPhrase, curatedSign, sampleCurated } from './curated'
import type { ResolvedSignMotion } from './types'
import type { PlaybackTimeline } from '../types'
import { blendOrientation } from './orientation'

const signCache = new Map<string, ResolvedSignMotion>()

export function resolveSign(clipId: string, mode: MotionOptions['mode'] = 'isolated'): ResolvedSignMotion {
  const cacheKey = `${mode}:${clipId}`
  const cached = signCache.get(cacheKey)
  if (cached) return cached
  const remember = (value: ResolvedSignMotion) => { signCache.set(cacheKey, value); return value }
  const custom = curatedSign(clipId)
  if (custom) return remember({ source: 'curated-sign', clipId, durationMs: custom.duration_ms, curated: custom })
  if (!clipId.startsWith('fs:') && isParameterised(clipId))
    return remember({ source: 'procedural', clipId, durationMs: clipLengthMs(clipId, mode) })
  const letters = clipId.replace(/^fs:/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  return remember({ source: 'fingerspelling', clipId: `fs:${letters}`, durationMs: Math.max(700, letters.length * 360) })
}
export function resolvedMotionFor(clipId: string, seconds: number, options: MotionOptions = {}) {
  if (clipId === 'idle') return motionFor('idle', seconds)
  const resolved = resolveSign(clipId, options.mode)
  const duration = options.durationMs ?? resolved.durationMs
  const pose = resolved.curated ? { ...sampleCurated(resolved.curated, ((seconds * 1000 % duration) + duration) % duration / duration) }
    : motionFor(resolved.clipId, seconds, { ...options, durationMs: duration })
  // Canonicalize at every source boundary, including exact keyframe endpoints.
  for (const side of ['rightArm', 'leftArm'] as const) {
    const arm = pose[side]
    if (arm) pose[side] = { ...arm, ...blendOrientation(arm.palm, arm.point, arm.palm, arm.point, 0) }
  }
  return pose
}

const timelineCache = new WeakMap<PlaybackTimeline, PlaybackTimeline>()
/** Upgrade backend or offline lexical timelines without mutating their plans. */
export function resolveTimeline(input: PlaybackTimeline): PlaybackTimeline {
  const cached = timelineCache.get(input)
  if (cached) return cached
  const phrase = curatedPhrase(input.clips.map(c => c.sign_id))
  let offset = 0
  const clips = input.clips.map((clip, i) => {
    const resolved = resolveSign(clip.clip_id, 'continuous')
    const start = phrase ? phrase.motion.boundaries![i] * phrase.motion.duration_ms : offset
    const end = phrase ? phrase.motion.boundaries![i + 1] * phrase.motion.duration_ms : start + resolved.durationMs
    offset = end
    return { ...clip, clip_id: resolved.clipId, start_ms: start, end_ms: end,
      source: phrase ? 'curated-phrase' as const : resolved.source }
  })
  // Nonmanual spans are mapped by lexical boundaries, never by an unrelated
  // whole-utterance stretch. This preserves question scope after phrase timing.
  const remap = (ms: number) => {
    const index = input.clips.findIndex(c => ms >= c.start_ms && ms < c.end_ms)
    if (index < 0) return ms <= 0 ? 0 : offset
    const old = input.clips[index], next = clips[index]
    return next.start_ms + (ms - old.start_ms) / (old.end_ms - old.start_ms) * (next.end_ms - next.start_ms)
  }
  const result: PlaybackTimeline = { ...input, clips, duration_ms: offset,
    curated_phrase: phrase?.id,
    nonmanuals: input.nonmanuals.map(s => ({ ...s, start_ms: remap(s.start_ms), end_ms: remap(s.end_ms) })) }
  timelineCache.set(input, result); timelineCache.set(result, result)
  return result
}
export function singleSignTimeline(id: string): PlaybackTimeline {
  const resolved = resolveSign(id)
  return { version: 2, renderer: 'sign-procedural-v2', duration_ms: resolved.durationMs,
    clips: [{ anchor: 's1', sign_id: canonicalId(id), clip_id: id, start_ms: 0, end_ms: resolved.durationMs, realization: resolved.source }], nonmanuals: [] }
}

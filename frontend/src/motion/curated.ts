import data from '../../../data/asl_curated_motions.json'
import { blendPoses, handshapeFor, motionFor, type Pose } from '../clips'
import type { CuratedMotion, KeyHand, MotionKeyframe } from './types'
import { applyNonmanuals, spanWeight } from './nonmanuals'
import { clamp01, smoothstep } from './phases'
import { blendOrientation } from './orientation'
import { coordinateHands } from './relationships'

export const curated = data as unknown as { signs: Record<string, CuratedMotion>; phrases: Record<string, CuratedMotion> }
export const canonicalId = (id: string) => id.toUpperCase().replace(/-/g, '_')
export const curatedSign = (id: string) => curated.signs[canonicalId(id)]
const phraseIndex = new Map(Object.entries(curated.phrases).map(([id, motion]) => [(motion.sequence ?? []).join('|'), { id, motion }]))
export const curatedPhrase = (sequence: string[]) => phraseIndex.get(sequence.map(canonicalId).join('|'))
const frames = new WeakMap<CuratedMotion, { t: number; pose: Pose }[]>()

function keyPose(def: CuratedMotion, frame: MotionKeyframe): Pose {
  const base = motionFor(def.base_clip, Math.min(frame.t, .999999) * def.duration_ms / 1000, { durationMs: def.duration_ms })
  const pose = { ...base }
  for (const side of ['right', 'left'] as const) {
    const hand: KeyHand | undefined = frame[side]
    if (!hand) continue
    const { shape, hand: joints, ...arm } = hand
    pose[`${side}Arm`] = { ...base[`${side}Arm`]!, ...arm }
    pose[`${side}Hand`] = joints ?? (shape ? handshapeFor(shape) : base[`${side}Hand`])
  }
  const { t: _t, right: _r, left: _l, ...controls } = frame
  for (const side of ['rightArm', 'leftArm'] as const) {
    const arm = pose[side]
    if (arm) pose[side] = { ...arm, ...blendOrientation(arm.palm, arm.point, arm.palm, arm.point, 0) }
  }
  return applyNonmanuals(pose, controls)
}
export function sampleCurated(def: CuratedMotion, normalizedTime: number): Pose {
  let keys = frames.get(def)
  if (!keys) { keys = def.keyframes.map(frame => ({ t: frame.t, pose: keyPose(def, frame) })); frames.set(def, keys) }
  const t = clamp01(normalizedTime)
  const index = keys.findIndex((key, i) => i > 0 && key.t >= t)
  let pose: Pose
  if (index < 1) pose = keys[keys.length - 1].pose
  else {
    const a = keys[index - 1], b = keys[index]
    pose = blendPoses(a.pose, b.pose, smoothstep((t - a.t) / (b.t - a.t)))
  }
  if (def.relationship && pose.rightArm && pose.leftArm)
    pose = { ...pose, ...coordinateHands(pose.rightArm, pose.leftArm, def.relationship, t) }
  for (const span of def.nonmanuals ?? []) if (t >= span.start && t < span.end)
    pose = applyNonmanuals(pose, span.controls, spanWeight(t * def.duration_ms, span.start * def.duration_ms, span.end * def.duration_ms))
  return pose
}

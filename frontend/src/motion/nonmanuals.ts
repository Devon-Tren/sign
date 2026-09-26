import type { Pose, Vec3 } from '../clips'
import type { NonmanualControls } from './types'
import { smoothstep } from './phases'

export function blendControls(a: NonmanualControls = {}, b: NonmanualControls = {}, t: number): NonmanualControls {
  const result: Record<string, number | Vec3> = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key as keyof NonmanualControls], bv = b[key as keyof NonmanualControls]
    if (Array.isArray(av) || Array.isArray(bv)) {
      const x = (av ?? [0, 0, 0]) as Vec3, y = (bv ?? [0, 0, 0]) as Vec3
      result[key] = x.map((v, i) => v + (y[i] - v) * t) as unknown as Vec3
    } else result[key] = Number(av ?? 0) + (Number(bv ?? 0) - Number(av ?? 0)) * t
  }
  return result as NonmanualControls
}
export function applyNonmanuals(pose: Pose, controls: NonmanualControls, weight = 1): Pose {
  const merged = { ...controls }
  if (controls.brow !== undefined) {
    merged.browRaise = Math.max(0, controls.brow); merged.browFurrow = Math.max(0, -controls.brow)
  }
  const previous = Object.fromEntries(Object.keys(merged).map(key => [key, pose.nonmanual?.[key as keyof NonmanualControls]])) as NonmanualControls
  const result = { ...pose, nonmanual: { ...pose.nonmanual, ...blendControls(previous, merged, weight) } }
  for (const key of ['browRaise', 'browFurrow', 'mouth', 'headShake', 'torso'] as const)
    if (merged[key] !== undefined) result[key] = pose[key] + (merged[key]! - pose[key]) * weight
  if (merged.head) result.head = pose.head.map((v, i) => v + (merged.head![i] - v) * weight) as unknown as Vec3
  return result
}
export function spanWeight(time: number, start: number, end: number) {
  const ramp = Math.min(120, (end - start) / 4)
  return smoothstep((time - start) / ramp) * smoothstep((end - time) / ramp)
}

import type { ArmPose, Vec3 } from '../clips'
import type { HandRelationship } from './types'
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + (b[i] - v) * t) as unknown as Vec3
/** Couples wrist paths. Existing surface-specific relationships remain the default. */
export function coordinateHands(right: ArmPose, left: ArmPose, relationship: HandRelationship, t: number) {
  const r = { ...right }, l = { ...left }, offset = relationship.offset ?? [.14, .07, .02]
  switch (relationship.type) {
    case 'mirrored': l.target = [-r.target[0], r.target[1], r.target[2]]; break
    case 'parallel': l.target = [r.target[0] - .4, r.target[1], r.target[2]]; break
    case 'alternating': break // opposite phase is sampled by the procedural generator
    case 'dominant_support': break // keep the stationary base and surface-relative dominant path
    case 'contact': {
      const amount = Math.min(1, t / (relationship.contactAt ?? .65))
      r.target = mix(r.target, l.target.map((v, i) => v + offset[i]) as unknown as Vec3, amount)
      r.contact = l.contact = amount >= 1
      break
    }
    case 'approaching': case 'separating': {
      const amount = (relationship.type === 'approaching' ? t : 1 - t) * .7
      const center = mix(r.target, l.target, .5)
      r.target = mix(r.target, center, amount); l.target = mix(l.target, center, amount)
    }
  }
  return { rightArm: r, leftArm: l }
}

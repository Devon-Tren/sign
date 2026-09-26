import type { ArmPose, HandPose, Pose, Vec3 } from '../clips'

export type MotionSource = 'curated-phrase' | 'curated-sign' | 'procedural' | 'fingerspelling'
export type Phase = 'preparation' | 'stroke' | 'hold' | 'transition'
/** Normalized ends of preparation, stroke and hold; transition ends at 1. */
export type Phases = readonly [number, number, number]
export type NonmanualControls = {
  brow?: number; browRaise?: number; browFurrow?: number; mouth?: number
  head?: Vec3; torso?: number; headShake?: number; headNod?: number
  eyeAperture?: number; gaze?: Vec3; mouthShape?: number; cheek?: number
  torsoLean?: number; bodyShift?: number
}
export type HandRelationship = {
  type: 'mirrored' | 'parallel' | 'alternating' | 'dominant_support' | 'approaching' | 'separating' | 'contact'
  dominant?: 'right'; phaseOffset?: number; contactAt?: number; offset?: Vec3
}
export type KeyHand = Partial<ArmPose> & { shape?: string; hand?: HandPose }
export type MotionKeyframe = NonmanualControls & { t: number; right?: KeyHand; left?: KeyHand }
export type CuratedMotion = {
  duration_ms: number; status: 'experimental'; provenance: string
  base_clip: string; phases?: Phases; relationship?: HandRelationship
  keyframes: MotionKeyframe[]
  sequence?: string[]
  boundaries?: number[]
  nonmanuals?: { start: number; end: number; controls: NonmanualControls }[]
}
export type ResolvedSignMotion = {
  source: MotionSource; clipId: string; durationMs: number; curated?: CuratedMotion
}
export type MotionSnapshot = {
  timeMs: number; pose: Pose; wristWorld: { right: number[]; left: number[] }
  handWorld: { right: number[]; left: number[] }; missingMorphs: string[]
}

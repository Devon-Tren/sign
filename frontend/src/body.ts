/**
 * Whole-body participation.
 *
 * A signer is not a torso with two arms bolted on: the chest turns a little
 * toward where the dominant hand works, the body leans in to reach forward or
 * to meet the hand at the face, and the head inclines toward a hand that
 * contacts it. The rig had none of this - a rigid mannequin torso and a head
 * that only drifted with gaze - which is a large part of what read as robotic.
 *
 * Everything here is derived from the pose the hands are already following,
 * so it is continuous whenever the hand paths are. Magnitudes are deliberately
 * small (a few degrees): the point is that the body is alive and participates,
 * not that it performs.
 *
 * Conventions (arm-reach body frame, from rendered axis tests):
 *   yaw > 0     chest turns toward the DOMINANT side
 *   forward > 0 torso leans forward
 *   side > 0    torso bends toward the dominant side
 *   headPitch > 0 head nods forward/down; headYaw > 0 toward the dominant side;
 *   headRoll > 0 ear toward the dominant shoulder
 */
import type { Pose } from './clips'

export type BodyMotion = {
  yaw: number
  forward: number
  side: number
  headPitch: number
  headYaw: number
  headRoll: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export function bodyMotion(pose: Pose): BodyMotion {
  const r = pose.rightArm, l = pose.leftArm
  if (!r) return { yaw: 0, forward: 0, side: 0, headPitch: 0, headYaw: 0, headRoll: 0 }
  const [x, y, z] = r.target
  // Only while the hand is up in signing space; at rest the body is quiet.
  const active = smooth(-0.72, -0.42, y)
  // Both hands up and working together centre the chest.
  const twoHanded = l ? smooth(-0.72, -0.42, l.target[1]) : 0
  // Chest turns toward the working hand's side, and back toward the midline
  // when the hand crosses the body.
  const yaw = clamp((x - 0.2) * 0.4, -0.10, 0.09) * active * (1 - 0.6 * twoHanded)
  // Lean into forward reaches; lean a touch in to meet the hand at the face.
  const atFace = smooth(0.12, 0.3, y) * smooth(0.46, 0.34, z)
  const forward = (clamp((z - 0.5) * 0.3, -0.02, 0.07) + 0.035 * atFace) * active
  // A high one-handed sign lifts that side a little.
  const side = clamp((y - 0.1) * 0.06, 0, 0.025) * active * (1 - twoHanded)
  // Head: incline toward a hand at the face, nod slightly to meet it.
  const headPitch = 0.045 * atFace
  const headYaw = clamp(x * 0.1, -0.03, 0.04) * active
  const headRoll = 0.04 * atFace * Math.sign(x || 1)
  return { yaw, forward, side, headPitch, headYaw, headRoll }
}

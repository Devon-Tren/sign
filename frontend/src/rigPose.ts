/** One body-to-rig path shared by playback, contact sheets and the inspector. */
import * as THREE from 'three'
import { applyHand, applyTorso, handPoint, reachOffset, relaxPoint, resetContinuity, setHandOrientation, smoothTarget, solveArmIK, tracking,
  type ArmChain, type SignerRig } from './signerRig'
import { breathAt, idlePose, type ArmPose, type Pose, type Vec3 } from './clips'
import { torsoFrontZ } from './anchors'
import { bodyMotion } from './body'

const target = new THREE.Vector3(), palm = new THREE.Vector3(), point = new THREE.Vector3()
const elbow = new THREE.Vector3()
const left = new THREE.Vector3(), right = new THREE.Vector3(), origin = new THREE.Vector3()

export function bodyOrigin(rig: SignerRig): THREE.Vector3 {
  // Rest shoulder midpoint: moving the clavicle must not move its own target.
  left.copy(rig.shoulder.left); right.copy(rig.shoulder.right)
  rig.root.localToWorld(left); rig.root.localToWorld(right)
  return origin.copy(left).add(right).multiplyScalar(0.5)
}

export function bodyToWorld(rig: SignerRig, value: Vec3, out: THREE.Vector3, contact = false, exactPoint = false) {
  const mid = bodyOrigin(rig)
  const reach = rig.right.upperLen + rig.right.foreLen
  const center = 1 - THREE.MathUtils.clamp(Math.abs(value[0]) / 0.58, 0, 1)
  const band = 1 - THREE.MathUtils.clamp(Math.abs(value[1] + 0.22) / 0.46, 0, 1)
  // Wrist targets are pushed off the body; a contact POINT is used as given.
  const minForward = exactPoint ? -Infinity : contact ? 0.15 : 0.22 + center * band * 0.13
  return out.set(mid.x - value[0] * reach, mid.y + value[1] * reach,
    mid.z + Math.max(value[2], minForward) * reach)
}

export function directionToWorld(value: Vec3, out: THREE.Vector3) {
  out.set(-value[0], value[1], value[2])
  if (!Number.isFinite(out.lengthSq()) || out.lengthSq() < 1e-12) return out.set(0, 1, 0)
  return out.normalize()
}

const _dq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _pw = new THREE.Quaternion()
const _pivot = new THREE.Vector3(), _moved = new THREE.Vector3()
/** World rotation of `bones` (a parent->child chain) away from their rest pose,
 *  about the first bone's joint; the chain's own parent is static. */
function chainDelta(rig: SignerRig, bones: (THREE.Bone | undefined)[], out: THREE.Quaternion) {
  const chain = bones.filter(Boolean) as THREE.Bone[]
  out.identity(); _rq.identity()
  for (const b of chain) { out.multiply(b.quaternion); _rq.multiply(rig.face.rest.get(b) ?? b.quaternion) }
  chain[0].parent?.getWorldQuaternion(_pw)
  out.multiply(_rq.invert()).premultiply(_pw).multiply(_pw.clone().invert())
  return chain[0].getWorldPosition(_pivot)
}
/** Move a surface target with the body part it is on. */
function followBody(rig: SignerRig, attach: { head?: number; torso?: number }, target: THREE.Vector3) {
  const torso = attach.torso ?? 0, head = attach.head ?? 0
  if (torso + head < 1e-6) return
  const face = rig.face
  const pivot = chainDelta(rig, head > 0 ? [...face.spine, face.neck, face.head] : face.spine, _dq)
  _moved.copy(target).sub(pivot).applyQuaternion(_dq).add(pivot)
  target.lerp(_moved, Math.min(1, torso + head))
}

const reachScratch = new THREE.Vector3()
/** Push a world-space wrist target forward if it lies in or against the torso. */
function keepOutOfTorso(rig: SignerRig, wrist: THREE.Vector3, palmContact = 0) {
  const mid = bodyOrigin(rig), reach = rig.right.upperLen + rig.right.foreLen
  const x = -(wrist.x - mid.x) / reach, y = (wrist.y - mid.y) / reach, z = (wrist.z - mid.z) / reach
  if (Math.abs(x) > 0.32 || y > 0.12) return
  const front = torsoFrontZ(y) + bodyTuning.wristClearance * (1 - palmContact)
  if (z < front) wrist.z = mid.z + front * reach
}
/** How far in front of the torso surface a derived wrist must stay (arm reach). */
const WRIST_CLEARANCE = 0.05
/** Exported for the ablations in artifacts/rig-verify. */
export const bodyTuning = { wristClearance: WRIST_CLEARANCE }

/**
 * A request that moves further in one step than any planned motion can (the
 * scheduler caps transitions at 3.2 reach/s and 12 rad/s: 0.053 reach and
 * 0.2 rad per 60 fps frame) is a discontinuity, not motion.
 */
const JUMP_REACH = 0.08, JUMP_TURN = 0.5
const lastRequest = new WeakMap<ArmChain, ArmPose>()
function isJump(arm: ArmChain, value: ArmPose) {
  const last = lastRequest.get(arm)
  lastRequest.set(arm, value)
  if (!last) return false
  const turn = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1,
    (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1))))
  return Math.hypot(value.target[0] - last.target[0], value.target[1] - last.target[1],
    value.target[2] - last.target[2]) > JUMP_REACH
    || turn(value.palm, last.palm) > JUMP_TURN || turn(value.point, last.point) > JUMP_TURN
}

export type ApplyOptions = {
  /** Land exactly on the requested pose each frame (default). The planned
   *  motion is already smooth and velocity-bounded; `exact: false` restores the
   *  legacy damped follower, kept only for comparison. */
  exact?: boolean
}

export function applyManualPose(rig: SignerRig, pose: Pose, at: number, dt: number,
  opts: ApplyOptions = {}) {
  const previous = tracking.exact
  tracking.exact = opts.exact ?? true
  try {
    // The body participates (./body): turn, lean and side bend follow the
    // hands; breathing and the expression-driven side lean stay.
    const body = bodyMotion(pose)
    applyTorso(rig.face, body.forward, body.yaw, body.side + pose.torso, breathAt(at) * 0.018, dt)
    const rest = idlePose(at)
    const drive = (arm: ArmChain, side: number, value: ArmPose) => {
      if (isJump(arm, value)) resetContinuity(arm)
      // Settle an inferred finger direction FIRST (against the forearm from the
      // last frame), so the contact offset below and the solve use the same
      // hand frame. Relaxing after the offset swung fingertips 5-7 cm off
      // their contact point.
      const palmW = directionToWorld(value.palm, palm), pointW = directionToWorld(value.point, point)
      if ((value.pointTolerance ?? 0) > 0) relaxPoint(arm, palmW.normalize(), pointW, value.pointTolerance!, value.wristMax)
      const reaching = !!value.reach && ((value.reach.tip ?? 0) + (value.reach.thumb ?? 0) + (value.reach.palm ?? 0)) > 1e-6
      if (reaching) {
        // A surface/space point for part of the hand: place that part there
        // and derive the wrist from the real hand geometry, then keep the wrist
        // out of the chest (it may land a little off contact instead).
        bodyToWorld(rig, value.target, target, true, true)
        if (value.attach) followBody(rig, value.attach, target)
        target.sub(reachOffset(arm, palmW, pointW, value.reach!, reachScratch))
        // A palm placed on the chest needs surface contact, not the normal
        // hovering clearance. Blend the allowance with the contact weights.
        const palmContact = Math.min(1, (value.reach?.palm ?? 0) * (value.attach?.torso ?? 0))
          * Math.max(0, -value.palm[2])
        keepOutOfTorso(rig, target, palmContact)
      } else {
        bodyToWorld(rig, value.target, target, value.contact)
        // Authored and relation wrist targets obey the same rule: never inside
        // the torso (MORNING's support wrist was authored 0.19 inside it).
        keepOutOfTorso(rig, target)
      }
      const pole = value.elbow ? directionToWorld(value.elbow, elbow) : undefined
      solveArmIK(arm, smoothTarget(arm, target, dt), side, dt, pole, palmW, pointW, value.wristMax)
      setHandOrientation(arm, palmW, pointW, dt, value.wristMax, 0)
    }
    drive(rig.right, -1, pose.rightArm ?? rest.rightArm!)
    drive(rig.left, 1, pose.leftArm ?? rest.leftArm!)
    applyHand(rig.right, pose.rightHand.fingers, pose.rightHand.thumb, dt)
    applyHand(rig.left, pose.leftHand.fingers, pose.leftHand.thumb, dt)
  } finally {
    tracking.exact = previous
  }
}

/** Actual solved bones, not a copy of requested targets. */
export function rigSnapshot(rig: SignerRig) {
  const mid = bodyOrigin(rig).clone()
  const reach = rig.right.upperLen + rig.right.foreLen
  const position = (bone: THREE.Object3D) => {
    const v = bone.getWorldPosition(new THREE.Vector3()).sub(mid).divideScalar(reach)
    return [-v.x, v.y, v.z]
  }
  const arm = (a: ArmChain) => {
    const delta = a.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(a.handRestWorldQ.clone().invert())
    const direction = (v: THREE.Vector3) => {
      const d = v.clone().applyQuaternion(delta).normalize()
      return [-d.x, d.y, d.z]
    }
    const fingerDirections = a.fingers.map(f => {
      const base = position(f.bones[0]), tip = position(f.bones.at(-1)!)
      const d = tip.map((v, i) => v - base[i])
      const length = Math.hypot(...d) || 1
      return d.map(v => v / length)
    })
    const at = (w: { tip?: number; thumb?: number; palm?: number }) => {
      const v = handPoint(a, w, new THREE.Vector3()).sub(mid).divideScalar(reach)
      return [-v.x, v.y, v.z]
    }
    return { shoulder: position(a.upper), elbow: position(a.fore), wrist: position(a.hand),
      tip: at({ tip: 1 }), thumbTip: at({ thumb: 1 }), palmCentre: at({ palm: 1 }),
      forearmLength: a.foreLen / reach, palm: direction(a.palmNormal),
      point: direction(a.along), fingerDirections,
      distalJoints: a.fingers.map(f => position(f.bones.at(-1)!)) }
  }
  return { right: arm(rig.right), left: arm(rig.left),
    eyes: rig.face.eyes.map(position), head: rig.face.head ? position(rig.face.head) : null }
}
export type RigSnapshot = ReturnType<typeof rigSnapshot>
export { solverDebug } from './signerRig'
export { solverTuning } from './signerRig'

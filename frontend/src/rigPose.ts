/** One body-to-rig path shared by playback, contact sheets and the inspector. */
import * as THREE from 'three'
import { applyHand, applySpine, setHandOrientation, smoothTarget, solveArmIK,
  type ArmChain, type SignerRig } from './signerRig'
import { breathAt, idlePose, type ArmPose, type Pose, type Vec3 } from './clips'

const target = new THREE.Vector3(), palm = new THREE.Vector3(), point = new THREE.Vector3()
const elbow = new THREE.Vector3()
const left = new THREE.Vector3(), right = new THREE.Vector3(), origin = new THREE.Vector3()

export function bodyOrigin(rig: SignerRig): THREE.Vector3 {
  // Rest shoulder midpoint: moving the clavicle must not move its own target.
  left.copy(rig.shoulder.left); right.copy(rig.shoulder.right)
  rig.root.localToWorld(left); rig.root.localToWorld(right)
  return origin.copy(left).add(right).multiplyScalar(0.5)
}

export function bodyToWorld(rig: SignerRig, value: Vec3, out: THREE.Vector3, contact = false) {
  const mid = bodyOrigin(rig)
  const reach = rig.right.upperLen + rig.right.foreLen
  const center = 1 - THREE.MathUtils.clamp(Math.abs(value[0]) / 0.58, 0, 1)
  const band = 1 - THREE.MathUtils.clamp(Math.abs(value[1] + 0.22) / 0.46, 0, 1)
  const minForward = contact ? 0.15 : 0.22 + center * band * 0.13
  return out.set(mid.x - value[0] * reach, mid.y + value[1] * reach,
    mid.z + Math.max(value[2], minForward) * reach)
}

export function directionToWorld(value: Vec3, out: THREE.Vector3) {
  out.set(-value[0], value[1], value[2])
  if (!Number.isFinite(out.lengthSq()) || out.lengthSq() < 1e-12) return out.set(0, 1, 0)
  return out.normalize()
}

export function applyManualPose(rig: SignerRig, pose: Pose, at: number, dt: number) {
  applySpine(rig.face, pose.torso, breathAt(at) * 0.018, dt)
  const rest = idlePose(at)
  const drive = (arm: ArmChain, side: number, value: ArmPose) => {
    bodyToWorld(rig, value.target, target, value.contact)
    const pole = value.elbow ? directionToWorld(value.elbow, elbow) : undefined
    solveArmIK(arm, smoothTarget(arm, target, dt), side, dt, pole,
      directionToWorld(value.palm, palm), directionToWorld(value.point, point), value.wristMax)
    setHandOrientation(arm, directionToWorld(value.palm, palm),
      directionToWorld(value.point, point), dt, value.wristMax)
  }
  drive(rig.right, -1, pose.rightArm ?? rest.rightArm!)
  drive(rig.left, 1, pose.leftArm ?? rest.leftArm!)
  applyHand(rig.right, pose.rightHand.fingers, pose.rightHand.thumb, dt)
  applyHand(rig.left, pose.leftHand.fingers, pose.leftHand.thumb, dt)
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
    return { shoulder: position(a.upper), elbow: position(a.fore), wrist: position(a.hand),
      forearmLength: a.foreLen / reach, palm: direction(a.palmNormal),
      point: direction(a.along), fingerDirections,
      distalJoints: a.fingers.map(f => position(f.bones.at(-1)!)) }
  }
  return { right: arm(rig.right), left: arm(rig.left),
    eyes: rig.face.eyes.map(position), head: rig.face.head ? position(rig.face.head) : null }
}
export type RigSnapshot = ReturnType<typeof rigSnapshot>

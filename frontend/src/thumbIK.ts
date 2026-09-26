/**
 * Position-based thumb placement.
 *
 * The angle model in ./signerRig (abduct / rotate / curl about fixed axes)
 * cannot put the thumb where ASL handshapes need it on the Rocketbox rig: its
 * CMC "curl" lifts the thumb off the palm and swings it toward the wrist, and a
 * brute-force search over the whole clamped range still leaves the tip 60-137%
 * of a palm width from a folded-B, S, 1 or T position. Anatomically CMC flexion
 * sweeps ACROSS the palm, which that axis layout does not express.
 *
 * So a handshape can instead name WHERE the thumb tip goes, as a weighted blend
 * of the hand's own joint positions (so it follows the fingers as they curl),
 * and a small CCD solve places the three thumb bones there within joint limits.
 * Sites are plain numbers so poses blend linearly between signs.
 */
import * as THREE from 'three'
import type { ArmChain } from './signerRig'

/** wrist, then MCP / PIP / DIP / tip for index, middle, ring, pinky. */
export const LANDMARK_COUNT = 17
export const landmark = (finger: 0 | 1 | 2 | 3, joint: 0 | 1 | 2 | 3) => 1 + finger * 4 + joint

export type ThumbSite = {
  /** Weights over the 17 landmarks; normalised when applied. */
  w: readonly number[]
  /** Offset along the palm normal, in palm widths (+ = palm side). */
  lift: number
  /** Offset toward the index (radial) side, in palm widths. */
  radial: number
  /** 0 = angle model only, 1 = fully placed by position. */
  weight: number
}

/** Build a site from sparse [landmark, weight] pairs. */
export function site(pairs: readonly (readonly [number, number])[], lift = 0, radial = 0): ThumbSite {
  const w = new Array(LANDMARK_COUNT).fill(0)
  for (const [i, v] of pairs) w[i] += v
  return { w, lift, radial, weight: 1 }
}

export function blendSites(a: ThumbSite | undefined, b: ThumbSite | undefined, t: number): ThumbSite | undefined {
  if (!a && !b) return undefined
  const x = a ?? { ...b!, weight: 0 }, y = b ?? { ...a!, weight: 0 }
  return {
    w: x.w.map((v, i) => v + (y.w[i] - v) * t),
    lift: x.lift + (y.lift - x.lift) * t,
    radial: x.radial + (y.radial - x.radial) * t,
    weight: x.weight + (y.weight - x.weight) * t,
  }
}

const _pts = Array.from({ length: LANDMARK_COUNT }, () => new THREE.Vector3())
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()
const _tip = new THREE.Vector3(), _target = new THREE.Vector3(), _pj = new THREE.Vector3()
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion()
const _dev = new THREE.Quaternion()

/** Extrapolated tip of a three-bone chain (Rocketbox has no tip bones). */
function chainTip(bones: readonly THREE.Bone[], out: THREE.Vector3) {
  bones.at(-1)!.getWorldPosition(_a)
  bones.at(-2)!.getWorldPosition(_b)
  return out.copy(_a).addScaledVector(_c.subVectors(_a, _b), 0.85)
}

/** World-space target for a site, from the hand's CURRENT finger pose. */
export function siteWorld(arm: ArmChain, s: ThumbSite, out: THREE.Vector3): THREE.Vector3 {
  arm.hand.getWorldPosition(_pts[0])
  arm.fingers.forEach((f, i) => {
    for (let j = 0; j < 3; j++) f.bones[j]?.getWorldPosition(_pts[1 + i * 4 + j])
    chainTip(f.bones, _pts[1 + i * 4 + 3])
  })
  let total = 0
  out.set(0, 0, 0)
  s.w.forEach((v, i) => { if (v) { out.addScaledVector(_pts[i], v); total += v } })
  if (total > 0) out.multiplyScalar(1 / total)
  const width = _pts[landmark(0, 0)].distanceTo(_pts[landmark(3, 0)])
  arm.hand.getWorldQuaternion(_q).multiply(_bq.copy(arm.handRestWorldQ).invert())
  _a.copy(arm.palmNormal).applyQuaternion(_q)
  out.addScaledVector(_a, s.lift * width)
  _b.subVectors(_pts[landmark(0, 0)], _pts[landmark(1, 0)]).normalize()
  return out.addScaledVector(_b, s.radial * width)
}

/** Largest rotation away from rest each thumb joint may take (CMC, MCP, IP). */
const THUMB_LIMIT = [1.35, 1.1, 1.25]

/**
 * CCD solve from the rest pose. Writes local quaternions into `out` and leaves
 * the bones exactly as it found them, so the caller controls blending/smoothing.
 */
export function solveThumbSite(arm: ArmChain, s: ThumbSite, out: THREE.Quaternion[]) {
  const bones = arm.thumb.bones
  const saved = bones.map(b => b.quaternion.clone())
  siteWorld(arm, s, _target)
  bones.forEach((b, i) => b.quaternion.copy(arm.thumb.restQ[i]))
  bones[0].updateMatrixWorld(true)
  for (let iter = 0; iter < 10; iter++) {
    for (let j = bones.length - 1; j >= 0; j--) {
      const b = bones[j]
      b.getWorldPosition(_pj)
      chainTip(bones, _tip)
      _a.subVectors(_tip, _pj).normalize()
      _b.subVectors(_target, _pj).normalize()
      if (_a.lengthSq() < 1e-10 || _b.lengthSq() < 1e-10) continue
      _q.setFromUnitVectors(_a, _b)
      // world delta -> local: local' = parentWorld^-1 * delta * boneWorld
      b.parent!.getWorldQuaternion(_pq)
      b.getWorldQuaternion(_bq)
      b.quaternion.copy(_pq.invert().multiply(_q).multiply(_bq))
      // Clamp the deviation from rest to a human range.
      _dev.copy(arm.thumb.restQ[j]).invert().multiply(b.quaternion)
      const angle = 2 * Math.acos(Math.min(1, Math.abs(_dev.w)))
      if (angle > THUMB_LIMIT[j]) {
        _dev.slerp(_q.identity(), 1 - THUMB_LIMIT[j] / angle)
        b.quaternion.copy(arm.thumb.restQ[j]).multiply(_dev)
      }
      b.updateMatrixWorld(true)
    }
  }
  bones.forEach((b, i) => { (out[i] ??= new THREE.Quaternion()).copy(b.quaternion); b.quaternion.copy(saved[i]) })
  bones[0].updateMatrixWorld(true)
  return out
}

/** Distance from the solved tip to its site, in palm widths (for tests/audit). */
export function siteError(arm: ArmChain, s: ThumbSite): number {
  siteWorld(arm, s, _target)
  chainTip(arm.thumb.bones, _tip)
  arm.fingers[0].bones[0].getWorldPosition(_a)
  arm.fingers[3].bones[0].getWorldPosition(_b)
  return _tip.distanceTo(_target) / _a.distanceTo(_b)
}

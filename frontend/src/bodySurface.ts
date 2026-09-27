/**
 * The avatar's own body surface, for keeping the hands out of it.
 *
 * keepOutOfTorso (./rigPose) holds the WRIST in front of a measured torso
 * profile, but nothing held the fingers or palm out of the chest, and nothing
 * at all held the hand out of the head: the body-safety audit
 * (tests/safety.audit.ts) found fingers 7 cm into the chest on FEEL and the
 * wrist 9 cm into the head on LEARN.
 *
 * This uses the real skinned mesh rather than proxy shapes, because contact
 * signs must land ON the forehead, chin or chest, and a sphere or capsule is
 * wrong by centimetres exactly there. Each vertex is stored in the frame of
 * the bone that dominates its skin weights, so the surface follows head turns
 * and torso lean exactly. Arms and hands are left out: they are what moves.
 */
import * as THREE from 'three'
import type { ArmChain, SignerRig } from './signerRig'

type Part = {
  bone: THREE.Bone
  pts: Float32Array
  nrm: Float32Array
  grid: Map<string, number[]>
  cell: number
  min: THREE.Vector3
  max: THREE.Vector3
  /** World-from-part for skinning (meshWorld * bindInverse * boneWorld), and its inverse. */
  toWorld: THREE.Matrix4
  toLocal: THREE.Matrix4
  scale: number
}

/** Adult shoulder-to-wrist length; converts centimetres to rig units. */
export const REACH_M = 0.52
const ARM_PART = /_[LR]_(UpperArm|Forearm|ForeTwist|Hand|Finger)|Twist/
/** Hips and legs are left out: the idle pose rests the hands against them by
 *  design, and pushing away from them drove the forearm into the back. */
const LOWER_BODY = /Pelvis|Thigh|Calf|Foot|Toe/
/** Inside the mouth: the lips and jaw are the surface in front of them, and
 *  their inward-facing normals flipped the push (9 m/s hand-speed spikes). */
const INTERNAL = /Tongue|Teeth/

const surfaces = new WeakMap<SignerRig, Part[]>()

export const cmToWorld = (rig: SignerRig, cm: number) =>
  cm / 100 / REACH_M * (rig.right.upperLen + rig.right.foreLen)

function build(rig: SignerRig): Part[] {
  const mesh = rig.mesh, skeleton = mesh.skeleton, geo = mesh.geometry
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const pos = geo.attributes.position, nor = geo.attributes.normal
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight
  if (!pos || !nor || !si || !sw) return []
  const byBone = new Map<number, number[]>()
  for (let v = 0; v < pos.count; v++) {
    let best = 0, weight = -1
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k)
      if (w > weight) { weight = w; best = si.getComponent(v, k) }
    }
    if (!byBone.has(best)) byBone.set(best, [])
    byBone.get(best)!.push(v)
  }
  mesh.updateMatrixWorld(true)
  const parts: Part[] = []
  const p = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Matrix4(), nm = new THREE.Matrix3()
  for (const [index, verts] of byBone) {
    const bone = skeleton.bones[index]
    if (!bone || verts.length < 8 || ARM_PART.test(bone.name) || LOWER_BODY.test(bone.name) || INTERNAL.test(bone.name)) continue
    m.multiplyMatrices(skeleton.boneInverses[index], mesh.bindMatrix)
    nm.getNormalMatrix(m)
    const pts = new Float32Array(verts.length * 3), nrm = new Float32Array(verts.length * 3)
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    verts.forEach((v, i) => {
      p.fromBufferAttribute(pos, v).applyMatrix4(m)
      n.fromBufferAttribute(nor, v).applyMatrix3(nm).normalize()
      p.toArray(pts, i * 3); n.toArray(nrm, i * 3)
      min.min(p); max.max(p)
    })
    parts.push({ bone, pts, nrm, grid: new Map(), cell: 0, min, max,
      toWorld: new THREE.Matrix4(), toLocal: new THREE.Matrix4(), scale: 1 })
  }
  refresh(rig, parts)
  for (const part of parts) {
    part.cell = cmToWorld(rig, 3) / part.scale
    for (let i = 0; i < part.pts.length / 3; i++) {
      const key = cellKey(part, part.pts[i * 3], part.pts[i * 3 + 1], part.pts[i * 3 + 2])
      if (!part.grid.has(key)) part.grid.set(key, [])
      part.grid.get(key)!.push(i)
    }
  }
  return parts
}

const cellKey = (part: Part, x: number, y: number, z: number) =>
  `${Math.floor(x / part.cell)},${Math.floor(y / part.cell)},${Math.floor(z / part.cell)}`

const _s = new THREE.Vector3()
function refresh(rig: SignerRig, parts: Part[]) {
  const mesh = rig.mesh
  for (const part of parts) {
    part.toWorld.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(part.bone.matrixWorld)
    part.toLocal.copy(part.toWorld).invert()
    _s.setFromMatrixScale(part.toWorld)
    part.scale = (_s.x + _s.y + _s.z) / 3
  }
}

/** Surface parts, with their transforms updated for the current pose. */
export function bodySurface(rig: SignerRig): Part[] {
  let parts = surfaces.get(rig)
  if (!parts) { parts = build(rig); surfaces.set(rig, parts) }
  else refresh(rig, parts)
  return parts
}

export type Contact = { depth: number; normal: THREE.Vector3; bone: string }

const _local = new THREE.Vector3()
const _near: [number, number][] = []
/**
 * Signed distance (world units, + outside) from `point` to one part's surface,
 * from the 4 nearest vertices by majority vote so one stray normal at a crease
 * cannot fake a penetration. Writes the outward world normal into `normal`.
 * Null when the point is nowhere near the part.
 */
export function signedDistance(part: Part, point: THREE.Vector3, normal?: THREE.Vector3): number | null {
  _local.copy(point).applyMatrix4(part.toLocal)
  const margin = part.cell
  if (_local.x < part.min.x - margin || _local.y < part.min.y - margin || _local.z < part.min.z - margin
    || _local.x > part.max.x + margin || _local.y > part.max.y + margin || _local.z > part.max.z + margin) return null
  _near.length = 0
  const cx = Math.floor(_local.x / part.cell), cy = Math.floor(_local.y / part.cell), cz = Math.floor(_local.z / part.cell)
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    for (const i of part.grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
      _near.push([Math.hypot(part.pts[i * 3] - _local.x, part.pts[i * 3 + 1] - _local.y, part.pts[i * 3 + 2] - _local.z), i])
    }
  }
  if (!_near.length) {
    const inside = _local.x > part.min.x && _local.y > part.min.y && _local.z > part.min.z
      && _local.x < part.max.x && _local.y < part.max.y && _local.z < part.max.z
    if (!inside) return null
    // Deep inside a large part: no vertex within a cell, so scan it all.
    for (let i = 0; i < part.pts.length / 3; i++) {
      _near.push([Math.hypot(part.pts[i * 3] - _local.x, part.pts[i * 3 + 1] - _local.y, part.pts[i * 3 + 2] - _local.z), i])
    }
  }
  _near.sort((a, b) => a[0] - b[0])
  const k = _near.slice(0, 4)
  // Inside by majority: the shallowest inside reading (conservative depth).
  // Outside: the nearest outside reading. The normal comes from that vertex.
  let inside = 0, inVal = -Infinity, inPick = k[0][1], outVal = Infinity, outPick = k[0][1]
  for (const [, i] of k) {
    const s = (_local.x - part.pts[i * 3]) * part.nrm[i * 3] + (_local.y - part.pts[i * 3 + 1]) * part.nrm[i * 3 + 1]
      + (_local.z - part.pts[i * 3 + 2]) * part.nrm[i * 3 + 2]
    if (s < 0) { inside++; if (s > inVal) { inVal = s; inPick = i } }
    else if (s < outVal) { outVal = s; outPick = i }
  }
  const isInside = inside * 2 > k.length
  const value = isInside ? inVal : outVal, pick = isInside ? inPick : outPick
  if (normal) {
    normal.set(part.nrm[pick * 3], part.nrm[pick * 3 + 1], part.nrm[pick * 3 + 2]).transformDirection(part.toWorld)
  }
  return value * part.scale
}

/** Points along one hand with the skin radius around each (cm): the joints
 *  are inside the hand, so the skin is that far out from them. */
export function handPoints(arm: ArmChain, out: { p: THREE.Vector3; r: number }[] = []) {
  out.length = 0
  const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
  const knuckles = arm.fingers[1].bones[0].getWorldPosition(new THREE.Vector3())
  out.push({ p: wrist, r: 2.4 }, { p: wrist.clone().lerp(knuckles, 0.55), r: 1.4 })
  for (const f of [...arm.fingers, arm.thumb]) {
    const joints = f.bones.map(b => b.getWorldPosition(new THREE.Vector3()))
    joints.forEach((p, i) => { if (i > 0) out.push({ p, r: 0.85 }) })
    const a = joints.at(-2) ?? wrist, b = joints.at(-1)!
    // The distal bone ends at its joint; the pad is about one segment on.
    out.push({ p: b.clone().add(b.clone().sub(a).multiplyScalar(0.8)), r: 0.75 })
  }
  return out
}

const _n = new THREE.Vector3()
/** The deepest skin overlap of this hand with the body (negative: clear by
 *  that much, within `marginCm`), or null when clear by more than the margin. */
export function deepestContact(rig: SignerRig, arm: ArmChain, parts = bodySurface(rig), marginCm = 0): Contact | null {
  let best: Contact | null = null
  const margin = cmToWorld(rig, marginCm)
  for (const { p, r } of handPoints(arm)) {
    const radius = cmToWorld(rig, r) + margin
    for (const part of parts) {
      const d = signedDistance(part, p, _n)
      if (d === null) continue
      const depth = radius - d
      if (depth > 0 && (!best || depth > best.depth)) best = { depth, normal: _n.clone(), bone: part.bone.name }
    }
  }
  if (best) best.depth -= margin
  return best
}

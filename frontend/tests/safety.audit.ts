/**
 * Body-safety audit.
 *
 * Replays every phrase in data/asl/phrase_bank.json, and each of its signs on
 * its own, through the production rig exactly as the Avatar plays them
 * (playbackPlan + poseAt, stepped at 60 Hz from rest), and measures the SOLVED
 * skeleton on every frame - transitions included, which is where phasing
 * usually happens:
 *
 *   joints      elbow flexion, shoulder extension and cross-body reach, forearm
 *               twist, wrist flexion and deviation, finger hyperextension
 *   collision   finger, palm, wrist and forearm points against the avatar's own
 *               skinned mesh (head, neck, torso, the other arm and hand)
 *   continuity  hand speed and per-frame hand rotation
 *
 * Collision uses the real mesh, not proxy capsules: each vertex is stored in
 * the frame of the bone that dominates its skin weights, so the surface follows
 * torso lean and head motion exactly. A point is tested against its nearest
 * surface vertices; the bone point sits inside the hand, so its skin radius is
 * added before comparing. Touching a surface (contact signs) is ~0 cm; anything
 * clearly below it is the hand phasing through the body.
 *
 *   npm run safety                      bank phrases + their signs
 *   npm run safety -- --all             every playable sign as well
 *   npm run safety -- --only where-is-the-bathroom,thank_you
 *   npm run safety -- --report-only     never exit 1
 *
 * Writes ../artifacts/safety/report.json. Exits 1 when any hard limit fails.
 */
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import bank from '../../data/asl/phrase_bank.json'
import { loadTestSigner } from './rigFixture'
import { applyManualPose, clearanceDebug, clearanceTuning } from '../src/rigPose'
import { playbackPlan, poseAt, singleSignPlan } from '../src/playback'
import { CONTINUOUS_LENGTH_MS, allSignIds, clipLengthMs, motionFor } from '../src/clips'
import { authoredSequenceFor } from '../src/authored'
import type { ArmChain } from '../src/signerRig'
import type { PlaybackTimeline } from '../src/types'
import type { Pose } from '../src/clips'

/** Adult shoulder-to-wrist length. Converts rig units to cm and m/s. */
const REACH_M = 0.52
const DT = 1 / 60

/** [warn, fail]. Angles in degrees, depths in cm, speeds in m/s, turns in deg/s. */
const LIMITS = {
  elbowFlex: [145, 155],
  shoulderBack: [40, 55],      // upper arm behind the coronal plane
  shoulderCross: [45, 60],     // upper arm across the chest past straight ahead
  forearmPronation: [80, 88],
  forearmSupination: [88, 95],
  wristFlex: [70, 85],
  wristDeviation: [25, 35],
  fingerHyperextension: [10, 25],
  // The thumb's joint frames differ from the fingers'; its sign convention is
  // unverified, so it is reported apart and needs a visual check.
  thumbHyperextension: [25, 45],
  penetration: [0.5, 1.5],
  handSpeed: [3.5, 5],
  handTurn: [900, 1500],
} as const
type Check = keyof typeof LIMITS

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
// Compare against the solver without whole-hand body clearance.
if (flag('--no-clearance')) clearanceTuning.enabled = false
if (flag('--clearance')) clearanceTuning.enabled = true
const trace = (() => { const i = args.indexOf('--trace'); return i >= 0 ? args[i + 1] : null })()
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null })()

/** Relative to where npm runs (frontend/), not to the bundle in node_modules. */
const OUT_DIR = new URL('../artifacts/safety/', pathToFileURL(process.cwd() + '/'))

const rig = await loadTestSigner()
rig.root.updateMatrixWorld(true)
const reachWorld = rig.right.upperLen + rig.right.foreLen
const cm = (world: number) => world / reachWorld * REACH_M * 100
const world = (centimetres: number) => centimetres / 100 / REACH_M * reachWorld

// ---------------------------------------------------------------- mesh surface

type Cloud = {
  bone: THREE.Bone; index: number
  pts: Float32Array; nrm: Float32Array
  grid: Map<string, number[]>; cell: number
  min: THREE.Vector3; max: THREE.Vector3
  /** Mesh-local-from-bone-cloud transform, refreshed per frame, and its inverse. */
  toWorld: THREE.Matrix4; toLocal: THREE.Matrix4; scale: number
}

const mesh = rig.mesh
const skeleton = mesh.skeleton
const geo = mesh.geometry
if (!geo.attributes.normal) geo.computeVertexNormals()

function buildClouds(): Cloud[] {
  const pos = geo.attributes.position, nor = geo.attributes.normal
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight
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
  const clouds: Cloud[] = []
  const p = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Matrix4(), nm = new THREE.Matrix3()
  for (const [index, verts] of byBone) {
    const bone = skeleton.bones[index]
    if (!bone || verts.length < 8) continue
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
    clouds.push({ bone, index, pts, nrm, grid: new Map(), cell: 0, min, max,
      toWorld: new THREE.Matrix4(), toLocal: new THREE.Matrix4(), scale: 1 })
  }
  refresh(clouds)
  for (const c of clouds) {
    // 3 cm cells in the cloud's own units.
    c.cell = world(3) / c.scale
    for (let i = 0; i < c.pts.length / 3; i++) {
      const key = cellKey(c, c.pts[i * 3], c.pts[i * 3 + 1], c.pts[i * 3 + 2])
      if (!c.grid.has(key)) c.grid.set(key, [])
      c.grid.get(key)!.push(i)
    }
  }
  return clouds
}

const cellKey = (c: Cloud, x: number, y: number, z: number) =>
  `${Math.floor(x / c.cell)},${Math.floor(y / c.cell)},${Math.floor(z / c.cell)}`

/** World-from-cloud for skinning: meshWorld * bindMatrixInverse * boneWorld. */
function refresh(clouds: Cloud[]) {
  const s = new THREE.Vector3()
  for (const c of clouds) {
    c.toWorld.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(c.bone.matrixWorld)
    c.toLocal.copy(c.toWorld).invert()
    s.setFromMatrixScale(c.toWorld)
    c.scale = (s.x + s.y + s.z) / 3
  }
}

const _local = new THREE.Vector3()
/** Signed distance (world units, + outside) from a world point to a cloud's
 *  surface, from the 4 nearest vertices; null when nowhere near it. */
function signedDistance(c: Cloud, point: THREE.Vector3): number | null {
  _local.copy(point).applyMatrix4(c.toLocal)
  const margin = c.cell
  if (_local.x < c.min.x - margin || _local.y < c.min.y - margin || _local.z < c.min.z - margin
    || _local.x > c.max.x + margin || _local.y > c.max.y + margin || _local.z > c.max.z + margin) return null
  const near: [number, number][] = []
  const cx = Math.floor(_local.x / c.cell), cy = Math.floor(_local.y / c.cell), cz = Math.floor(_local.z / c.cell)
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    for (const i of c.grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
      const d = Math.hypot(c.pts[i * 3] - _local.x, c.pts[i * 3 + 1] - _local.y, c.pts[i * 3 + 2] - _local.z)
      near.push([d, i])
    }
  }
  const inBox = _local.x > c.min.x && _local.y > c.min.y && _local.z > c.min.z
    && _local.x < c.max.x && _local.y < c.max.y && _local.z < c.max.z
  if (!near.length) {
    if (!inBox) return null
    // Deep inside a large part (torso): no vertex within a cell - scan it all.
    for (let i = 0; i < c.pts.length / 3; i++) {
      near.push([Math.hypot(c.pts[i * 3] - _local.x, c.pts[i * 3 + 1] - _local.y, c.pts[i * 3 + 2] - _local.z), i])
    }
  }
  near.sort((a, b) => a[0] - b[0])
  const k = near.slice(0, 4)
  const signed = k.map(([, i]) => (_local.x - c.pts[i * 3]) * c.nrm[i * 3]
    + (_local.y - c.pts[i * 3 + 1]) * c.nrm[i * 3 + 1] + (_local.z - c.pts[i * 3 + 2]) * c.nrm[i * 3 + 2])
  // Majority vote: one stray normal at a crease must not fake a penetration.
  const inside = signed.filter(s => s < 0).length
  const value = inside * 2 > signed.length ? Math.max(...signed.filter(s => s < 0)) : Math.min(...signed.filter(s => s >= 0))
  return value * c.scale
}

const clouds = buildClouds()
const ARM_PART = /(UpperArm|Forearm|ForeTwist|Twist|Elbow|Hand|Finger)/
const sideOf = (arm: ArmChain) => (arm === rig.right ? 'R' : 'L')
/** A hand is tested against everything except its own arm. */
const obstacles = (arm: ArmChain) => clouds.filter(c =>
  !(c.bone.name.includes(`_${sideOf(arm)}_`) && ARM_PART.test(c.bone.name)))
const OBSTACLES = { right: obstacles(rig.right), left: obstacles(rig.left) }

// ---------------------------------------------------------------- measurement

type Finding = { check: Check; value: number; level: 'warn' | 'fail'; at_ms: number; side: string; detail: string }
type ItemReport = { id: string; kind: 'phrase' | 'sign'; clips: string[]; missing: string[]; frames: number
  max: Partial<Record<Check, number>>; findings: Finding[] }

const v = () => new THREE.Vector3()
const P = (o: THREE.Object3D, out = v()) => o.getWorldPosition(out)
const deg = (r: number) => r * 180 / Math.PI

/** Points along the hand and forearm, with the skin radius around each (cm). */
function armPoints(arm: ArmChain): { name: string; p: THREE.Vector3; r: number }[] {
  const out: { name: string; p: THREE.Vector3; r: number }[] = []
  const wrist = P(arm.hand), elbow = P(arm.fore)
  out.push({ name: 'forearm', p: elbow.clone().lerp(wrist, 0.55), r: 3.0 })
  out.push({ name: 'wrist', p: wrist, r: 2.4 })
  const knuckles = P(arm.fingers[1].bones[0])
  out.push({ name: 'palm', p: wrist.clone().lerp(knuckles, 0.55), r: 1.4 })
  const names = ['index', 'middle', 'ring', 'pinky']
  const chains = [...arm.fingers.map((f, i) => [names[i], f] as const), ['thumb', arm.thumb] as const]
  for (const [name, f] of chains) {
    const joints = f.bones.map(b => P(b))
    joints.forEach((p, i) => { if (i > 0) out.push({ name: `${name}${i}`, p, r: 0.85 }) })
    const a = joints.at(-2) ?? P(arm.hand), b = joints.at(-1)!
    // Distal bone ends at its joint; the pad is about one segment further on.
    out.push({ name: `${name}Tip`, p: b.clone().add(b.clone().sub(a).multiplyScalar(0.8)), r: 0.75 })
  }
  return out
}

/** Hand rest axes in the forearm's rest frame, captured in bind pose. */
const WRIST_REST = Object.fromEntries((['right', 'left'] as const).map(side => {
  const arm = rig[side], inv = arm.fore.getWorldQuaternion(new THREE.Quaternion()).invert()
  return [side, { along: arm.along.clone().applyQuaternion(inv), palm: arm.palmNormal.clone().applyQuaternion(inv),
    across: arm.across.clone().applyQuaternion(inv) }]
})) as Record<'right' | 'left', { along: THREE.Vector3; palm: THREE.Vector3; across: THREE.Vector3 }>

const faceRight = rig.face.right.clone().normalize()
const faceForward = rig.face.forward.clone().normalize()

function joints(arm: ArmChain) {
  const shoulder = P(arm.upper), elbow = P(arm.fore), wrist = P(arm.hand)
  const other = arm === rig.right ? rig.left : rig.right
  const outward = Math.sign(shoulder.clone().sub(P(other.upper)).dot(faceRight)) || 1
  const upper = elbow.clone().sub(shoulder).normalize(), fore = wrist.clone().sub(elbow).normalize()
  const elbowFlex = deg(upper.angleTo(fore))
  const shoulderBack = deg(Math.asin(THREE.MathUtils.clamp(-upper.dot(faceForward), -1, 1)))
  // Across the chest: toward the other side in the horizontal plane, measured
  // from straight ahead. Only counts once the arm is raised off the side.
  const lateral = upper.dot(faceRight) * outward, forward = upper.dot(faceForward)
  const shoulderCross = forward > 0.2 ? deg(Math.atan2(-lateral, forward)) : 0
  // Forearm twist, as in rig.test.ts.
  const foreWorld = arm.fore.getWorldQuaternion(new THREE.Quaternion())
  const neutralPalm = new THREE.Vector3().crossVectors(arm.ikUpper, arm.ikFore).multiplyScalar(arm.side).normalize()
  const forePalm = new THREE.Vector3(0, 0, 1).applyQuaternion(arm.foreBasisInv.clone().invert()).applyQuaternion(foreWorld)
  const twist = -arm.side * Math.atan2(new THREE.Vector3().crossVectors(neutralPalm, forePalm).dot(arm.ikFore), neutralPalm.dot(forePalm))
  // Wrist: where the knuckle line points relative to the forearm, in the
  // forearm's rest frame, against the hand's own rest axes (along, palm,
  // across). Flexion turns it toward the palm, deviation toward the pinky or
  // thumb side; bind pose is 0/0.
  const rest = WRIST_REST[arm === rig.right ? 'right' : 'left']
  const handQ = arm.hand.getWorldQuaternion(new THREE.Quaternion())
  const along = arm.along.clone().applyQuaternion(handQ.multiply(arm.handRestWorldQ.clone().invert()))
    .applyQuaternion(foreWorld.clone().invert())
  const wristFlex = deg(Math.atan2(along.dot(rest.palm), along.dot(rest.along)))
  const wristDeviation = deg(Math.atan2(along.dot(rest.across), along.dot(rest.along)))
  // Fingers: signed curl about each joint's own axis; negative = bent backwards.
  let hyper = 0, where = '', thumbHyper = 0
  for (const f of [...arm.fingers, arm.thumb]) {
    f.bones.forEach((b, i) => {
      const q = f.restQ[i].clone().invert().multiply(b.quaternion)
      const axis = f.curlAxis[i]
      let a = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w)
      if (a > Math.PI) a -= 2 * Math.PI
      if (a < -Math.PI) a += 2 * Math.PI
      const back = -deg(a) * f.curlSign
      if (f === arm.thumb) thumbHyper = Math.max(thumbHyper, back)
      else if (back > hyper) { hyper = back; where = b.name }
    })
  }
  return { elbowFlex, shoulderBack, shoulderCross,
    forearmPronation: deg(-twist), forearmSupination: deg(twist),
    wristFlex: Math.abs(wristFlex), wristDeviation: Math.abs(wristDeviation),
    fingerHyperextension: hyper, hyperBone: where, thumbHyperextension: thumbHyper }
}

/** Skin overlap in the idle pose, per side and body part. Hands resting at the
 *  hips touch the jacket by design; that is reported once, on the idle item,
 *  and only overlap BEYOND it counts against a sign. */
let idleOverlap: Map<string, number> | null = null

function audit(id: string, kind: ItemReport['kind'], timeline: PlaybackTimeline, missing: string[],
  sample?: (ms: number) => Pose): ItemReport {
  const plan = sample ? timeline : playbackPlan(timeline)
  const posed = sample ?? ((ms: number) => poseAt(plan, ms))
  const overlap = new Map<string, number>()
  const report: ItemReport = { id, kind, clips: plan.clips.map(c => c.clip_id), missing, frames: 0, max: {}, findings: [] }
  const worst = new Map<string, Finding>()
  const note = (check: Check, value: number, at: number, side: string, detail: string) => {
    if (report.max[check] === undefined || value > report.max[check]!) report.max[check] = +value.toFixed(2)
    const [warnAt, failAt] = LIMITS[check]
    if (value <= warnAt) return
    const level = value > failAt ? 'fail' : 'warn'
    // One finding per check, side and body part: the worst frame of it.
    const key = `${check}|${side}|${detail}`
    const prev = worst.get(key)
    if (!prev || value > prev.value) worst.set(key, { check, value: +value.toFixed(2), level, at_ms: Math.round(at), side, detail })
  }

  const rest = motionFor('idle', 0)
  for (let k = 0; k < 30; k++) applyManualPose(rig, rest, 0, DT)
  rig.root.updateMatrixWorld(true)
  const last = { right: { tip: v(), q: new THREE.Quaternion() }, left: { tip: v(), q: new THREE.Quaternion() } }
  let first = true
  for (let t = 0; t <= plan.duration_ms; t += DT * 1000) {
    applyManualPose(rig, posed(t), t / 1000, DT)
    rig.root.updateMatrixWorld(true)
    refresh(clouds)
    report.frames++
    if (trace === id) {
      const fmt = (side: 'right' | 'left') => {
        const d = clearanceDebug.get(rig[side])
        return d ? `push ${cm(d.push).toFixed(1)}cm contact ${d.depth === null ? '-' : cm(d.depth).toFixed(1) + 'cm ' + d.bone}` : '-'
      }
      console.error(`${String(Math.round(t)).padStart(5)}ms  R ${fmt('right').padEnd(48)} L ${fmt('left')}`)
    }
    for (const side of ['right', 'left'] as const) {
      const arm = rig[side]
      const j = joints(arm)
      for (const check of ['elbowFlex', 'shoulderBack', 'shoulderCross', 'forearmPronation', 'forearmSupination',
        'wristFlex', 'wristDeviation'] as const) note(check, j[check], t, side, check)
      note('fingerHyperextension', j.fingerHyperextension, t, side, j.hyperBone)
      note('thumbHyperextension', j.thumbHyperextension, t, side, 'thumb')

      for (const point of armPoints(arm)) {
        for (const c of OBSTACLES[side]) {
          const d = signedDistance(c, point.p)
          if (d === null) continue
          const part = `${point.name}→${c.bone.name}`, depth = point.r - cm(d)
          overlap.set(`${side}|${part}`, Math.max(overlap.get(`${side}|${part}`) ?? -Infinity, depth))
          note('penetration', depth - Math.max(0, idleOverlap?.get(`${side}|${part}`) ?? 0), t, side, part)
        }
      }

      const tip = armPoints(arm).find(p => p.name === 'indexTip')!.p
      const q = arm.hand.getWorldQuaternion(new THREE.Quaternion())
      if (!first) {
        note('handSpeed', cm(tip.distanceTo(last[side].tip)) / 100 / DT, t, side, 'indexTip')
        note('handTurn', deg(q.angleTo(last[side].q)) / DT, t, side, 'hand')
      }
      last[side].tip.copy(tip); last[side].q.copy(q)
    }
    first = false
  }
  if (!idleOverlap) idleOverlap = overlap
  report.findings = [...worst.values()].sort((a, b) => (a.level === b.level ? b.value - a.value : a.level === 'fail' ? -1 : 1))
  return report
}

// ---------------------------------------------------------------- what to play

const playable = new Set(allSignIds())
type BankPhrase = { id: string; english: string; gloss: string[] }

function phraseTimeline(phrase: BankPhrase) {
  const clips: PlaybackTimeline['clips'] = []
  const missing: string[] = []
  let offset = 0
  const push = (clip_id: string, duration: number, realization: string) => {
    clips.push({ anchor: `a${clips.length + 1}`, sign_id: clip_id.toUpperCase(), clip_id,
      start_ms: offset, end_ms: offset + duration, realization })
    offset += duration
  }
  for (const token of phrase.gloss) {
    if (token.startsWith('FS:')) {
      const letters = token.slice(3).toLowerCase().replace(/[^a-z0-9]/g, '')
      push(`fs:${letters}`, Math.max(700, letters.length * 360), 'fingerspelling-approximation')
      continue
    }
    const id = token.toLowerCase()
    if (!playable.has(id)) { missing.push(token); continue }
    for (const part of authoredSequenceFor(id)?.clips ?? [id]) push(part, CONTINUOUS_LENGTH_MS[part] ?? 900, 'phrase-bank')
  }
  const timeline: PlaybackTimeline = { version: 2, renderer: 'sign-procedural-v2', duration_ms: offset, clips, nonmanuals: [] }
  return { timeline, missing }
}

const phrases = (bank as { phrases: BankPhrase[] }).phrases
const signIds = new Set<string>()
for (const phrase of phrases) for (const t of phrase.gloss) {
  if (!t.startsWith('FS:') && playable.has(t.toLowerCase())) signIds.add(t.toLowerCase())
}
if (flag('--all')) for (const id of playable) signIds.add(id)

const started = Date.now()
// First: the idle pose alone, which also sets the idle overlap baseline.
const reports: ItemReport[] = [audit('(idle)', 'sign',
  { version: 2, renderer: 'sign-procedural-v2', duration_ms: 1000, clips: [], nonmanuals: [] }, [],
  ms => motionFor('idle', ms / 1000))]
const queue = [
  ...[...signIds].sort().filter(id => !only || only.has(id)).map(id => ({ id, kind: 'sign' as const })),
  ...phrases.filter(p => !only || only.has(p.id)).map(p => ({ id: p.id, kind: 'phrase' as const, phrase: p })),
]
queue.forEach((item, i) => {
  // Silent for minutes otherwise, which reads as a hang.
  const elapsed = (Date.now() - started) / 1000
  const eta = i ? Math.round(elapsed / i * (queue.length - i)) : 0
  process.stderr.write(`\r[${i + 1}/${queue.length}] ${item.kind} ${item.id}`.padEnd(70) + (i ? `~${eta}s left ` : ''))
  if (item.kind === 'sign') {
    reports.push(audit(item.id, 'sign', singleSignPlan(item.id, clipLengthMs(item.id, 'isolated')), []))
    return
  }
  const { timeline, missing } = phraseTimeline(item.phrase!)
  if (timeline.clips.length) reports.push(audit(item.id, 'phrase', timeline, missing))
})
process.stderr.write('\n')

// ---------------------------------------------------------------- report

const findings = reports.flatMap(r => r.findings.map(f => ({ item: r.id, kind: r.kind, ...f })))
const byCheck = Object.fromEntries((Object.keys(LIMITS) as Check[]).map(check => {
  const hits = findings.filter(f => f.check === check)
  return [check, {
    limits: { warn: LIMITS[check][0], fail: LIMITS[check][1] },
    items_fail: new Set(hits.filter(f => f.level === 'fail').map(f => f.item)).size,
    items_warn: new Set(hits.filter(f => f.level === 'warn').map(f => f.item)).size,
    worst: [...hits].sort((a, b) => b.value - a.value).slice(0, 15),
  }]
}))
const failing = reports.filter(r => r.findings.some(f => f.level === 'fail'))
const summary = {
  generated: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
  units: { reach_m: REACH_M, depth: 'cm of skin overlap', speed: 'm/s', turn: 'deg/s', angles: 'deg' },
  items: reports.length, frames: reports.reduce((s, r) => s + r.frames, 0),
  items_failing: failing.length, items_clean: reports.filter(r => !r.findings.length).length,
  mesh_parts: clouds.length,
}
await fs.mkdir(OUT_DIR, { recursive: true })
await fs.writeFile(new URL('report.json', OUT_DIR),
  JSON.stringify({ summary, byCheck, items: reports }, null, 1))

console.log(JSON.stringify(summary, null, 2))
for (const [check, s] of Object.entries(byCheck)) {
  console.log(`${check.padEnd(22)} fail ${String(s.items_fail).padStart(3)}  warn ${String(s.items_warn).padStart(3)}`
    + (s.worst[0] ? `   worst ${s.worst[0].item} ${s.worst[0].side} ${s.worst[0].detail} = ${s.worst[0].value}` : ''))
}
console.log('report: artifacts/safety/report.json')
if (failing.length && !flag('--report-only')) process.exit(1)

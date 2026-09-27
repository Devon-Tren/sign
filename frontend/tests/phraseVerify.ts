/**
 * Phrase verification against the reference videos.
 *
 * For each phrase in data/asl/phrase_bank.json (first 100 by default), every
 * sign is played on the production rig exactly as the Avatar plays it and
 * measured in the same terms as its ASL-LEX reference video
 * (scripts/video_features.py): a front view, in a body frame with the origin
 * between the shoulders, one unit = shoulder width, +x toward the dominant
 * shoulder, +y up. Only the stroke is compared (the video's coded sign
 * onset/offset; the avatar's clip window, without the lead-in from rest).
 *
 *   handshape  knuckle (MCP) and middle-joint (PIP) bend of each finger
 *   path       palm-centre path, 10 samples across the stroke
 *   region     head / torso / low, from the fingertip against the mouth
 *   hands      one-handed or two-handed
 *
 * Each phrase then also needs a clean body-safety result for itself
 * (artifacts/safety/report.json, from `npm run safety`): no clipping into the
 * head, chest or other hand, and no joint past human range.
 *
 *   npm run phrases                     first 100 phrases
 *   npm run phrases -- --all            all 200
 *   npm run phrases -- --only how-are-you,thank-you
 *   npm run phrases -- --calibrate      score every sign against every video
 *
 * Needs the video features first (see scripts/video_features.py). Writes
 * ../artifacts/phrase-verify/report.json. Exits 1 when a phrase fails.
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import bank from '../../data/asl/phrase_bank.json'
import { loadTestSigner } from './rigFixture'
import { applyManualPose } from '../src/rigPose'
import { poseAt, singleSignPlan } from '../src/playback'
import { allSignIds, clipLengthMs, motionFor } from '../src/clips'
import type { ArmChain } from '../src/signerRig'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null })()
const cwd = pathToFileURL(process.cwd() + '/')
const FEATURES = new URL('../artifacts/reference-videos/features/', cwd)
const SAFETY = new URL('../artifacts/safety/report.json', cwd)
const OUT_DIR = new URL('../artifacts/phrase-verify/', cwd)
const DT = 1 / 60
const PHASES = 10
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const

/** Pass thresholds. Set from --calibrate (own video vs every other video). */
const LIMITS = {
  /** Mean palm-centre distance over the stroke, shoulder widths (~36 cm). */
  path: 0.45,
}

/**
 * Finger states, not raw angles. Against ASL-LEX's coded Flexion the video's
 * MCP+PIP bend orders correctly (fully open 51, bent 67, curved 78, flat 92,
 * fully closed 131; unselected fingers 127-139) but is compressed: MediaPipe
 * reads an open finger as ~50 degrees and a fist as ~130. The avatar spans
 * ~30 to ~170. So each side gets its own cut-offs, and a finger fails only
 * when it is clearly open on one side and clearly closed on the other.
 */
const FINGER_STATE = { video: { open: 65, closed: 115 }, avatar: { open: 60, closed: 140 } }
const stateOf = (bend: number, cut: { open: number; closed: number }) =>
  bend <= cut.open ? 'open' : bend >= cut.closed ? 'closed' : 'between'

type Flex = Record<typeof FINGERS[number], { mcp: number; pip: number }>
type Side = { path: number[][] | null; tip_path?: number[][] | null; flex: Flex | null; region: string | null; active?: boolean }
type Features = { token: string; right: Side; left: Side; face?: { mouth_y: number | null } }

// ---------------------------------------------------------------- avatar side

const rig = await loadTestSigner()
rig.root.updateMatrixWorld(true)
const bone = (name: string) => rig.root.getObjectByName(name)
const P = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
const lips = ['Bip01_MUpperLip', 'Bip01_MBottomLip'].map(bone).filter(Boolean) as THREE.Object3D[]
const thighs = ['Bip01_L_Thigh', 'Bip01_R_Thigh'].map(bone).filter(Boolean) as THREE.Object3D[]
const up = rig.face.up.clone().normalize()

function bodyFrame() {
  const r = P(rig.right.upper), l = P(rig.left.upper)
  const origin = r.clone().add(l).multiplyScalar(0.5)
  // Front view: drop depth (the video has none).
  const x = r.clone().sub(l).sub(up.clone().multiplyScalar(r.clone().sub(l).dot(up)))
  const width = x.length()
  x.normalize()
  return (p: THREE.Vector3) => { const d = p.clone().sub(origin); return [d.dot(x) / width, d.dot(up) / width] }
}

const angle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
  b.clone().sub(a).angleTo(c.clone().sub(b)) * 180 / Math.PI

function handAt(arm: ArmChain, to: (p: THREE.Vector3) => number[]) {
  const wrist = P(arm.hand)
  const bases = arm.fingers.map(f => P(f.bones[0]))
  const centre = [wrist, ...bases].reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / 5)
  const index = arm.fingers[0].bones.map(P)
  const tip = index[2].clone().add(index[2].clone().sub(index[1]).multiplyScalar(0.8))
  const flex = Object.fromEntries(arm.fingers.map((f, i) => {
    const [m, p, d] = f.bones.map(P)
    return [FINGERS[i], { mcp: angle(wrist, m, p), pip: angle(m, p, d) }]
  })) as Flex
  return { centre: to(centre), tip: to(tip), wrist: to(wrist), flex }
}

type Sample = { t: number; right: ReturnType<typeof handAt>; left: ReturnType<typeof handAt>; mouthY: number; restY: number }

const avatarCache = new Map<string, Features>()
function avatarFeatures(id: string): Features {
  const cached = avatarCache.get(id)
  if (cached) return cached
  const plan = singleSignPlan(id, clipLengthMs(id, 'isolated'))
  const start = plan.clips[0].start_ms, end = plan.clips[plan.clips.length - 1].end_ms
  const rest = motionFor('idle', 0)
  for (let k = 0; k < 30; k++) applyManualPose(rig, rest, 0, DT)
  const samples: Sample[] = []
  for (let t = 0; t <= plan.duration_ms; t += DT * 1000) {
    applyManualPose(rig, poseAt(plan, t), t / 1000, DT)
    if (t < start || t > end) continue
    rig.root.updateMatrixWorld(true)
    const to = bodyFrame()
    const mouth = lips.length ? lips.map(P).reduce((a, b) => a.add(b)).multiplyScalar(1 / lips.length) : null
    const hips = thighs.map(P).reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, thighs.length))
    samples.push({ t: (t - start) / Math.max(1, end - start), right: handAt(rig.right, to), left: handAt(rig.left, to),
      mouthY: mouth ? to(mouth)[1] : 0.5, restY: to(hips)[1] })
  }
  const side = (key: 'right' | 'left'): Side => {
    const path = (pick: (s: Sample) => number[]) => Array.from({ length: PHASES }, (_, k) => {
      const g = 0.05 + 0.9 * k / (PHASES - 1)
      const s = samples.reduce((best, x) => Math.abs(x.t - g) < Math.abs(best.t - g) ? x : best)
      return pick(s)
    })
    const mid = samples.filter(s => s.t >= 0.25 && s.t <= 0.75)
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
    const flex = Object.fromEntries(FINGERS.map(f => [f, {
      mcp: median(mid.map(s => s[key].flex[f].mcp)), pip: median(mid.map(s => s[key].flex[f].pip)) }])) as Flex
    const inner = samples.filter(s => s.t >= 0.1 && s.t <= 0.9)
    const tops = inner.map(s => Math.max(s[key].tip[1], s[key].centre[1])).sort((a, b) => a - b)
    const top = tops[Math.floor(tops.length * 0.8)]
    const mouthY = median(inner.map(s => s.mouthY))
    const region = top > mouthY - 0.3 ? 'head' : top > -1.3 ? 'torso' : 'low'
    const restY = median(samples.map(s => s.restY))
    // The wrist, as the video measures it (pose wrist: robust to overlapping hands).
    const active = samples.filter(s => s[key].wrist[1] > restY + 0.6).length > 0.5 * samples.length
    return { path: path(s => s[key].centre), tip_path: path(s => s[key].tip), flex, region, active }
  }
  const mouth = [...samples.map(s => s.mouthY)].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
  const features = { token: id.toUpperCase(), right: side('right'), left: side('left'), face: { mouth_y: mouth } }
  avatarCache.set(id, features)
  return features
}

// ---------------------------------------------------------------- comparison

function videoFeatures(token: string): Features | null {
  const file = new URL(`${token}.json`, FEATURES)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

const pathError = (a: number[][] | null, b: number[][] | null) => !a || !b ? null
  : a.reduce((s, p, i) => s + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / a.length
function handshapeError(avatar: Flex | null, video: Flex | null) {
  if (!avatar || !video) return null
  let worst = 0, finger = ''
  const clash: string[] = []
  for (const f of FINGERS) {
    const a = avatar[f].mcp + avatar[f].pip, v = video[f].mcp + video[f].pip
    if (!Number.isFinite(a) || !Number.isFinite(v)) continue
    const sa = stateOf(a, FINGER_STATE.avatar), sv = stateOf(v, FINGER_STATE.video)
    if (sa !== 'between' && sv !== 'between' && sa !== sv) clash.push(`${f} ${sa} (video ${sv})`)
    const e = Math.abs(a - v)
    if (e > worst) { worst = e; finger = f }
  }
  return { worst, finger, clash }
}

type SignCheck = { token: string; clip: string | null; ok: boolean; problems: string[]
  path?: number | null; handshape?: number | null; region?: [string | null, string | null]; twoHanded?: [boolean, boolean]
  detail?: { avatarPath: number[][] | null; videoPath: number[][] | null; avatarFlex: Flex | null; videoFlex: Flex | null
    avatarMouth: number | null; videoMouth: number | null } }

function checkSign(token: string): SignCheck {
  const id = token.toLowerCase()
  if (token.startsWith('FS:')) return { token, clip: null, ok: true, problems: ['fingerspelled: no reference video (not scored)'] }
  if (!allSignIds().includes(id)) return { token, clip: null, ok: false, problems: ['no motion for this sign'] }
  const video = videoFeatures(token)
  if (!video) return { token, clip: id, ok: false, problems: ['no video features (run scripts/video_features.py)'] }
  const avatar = avatarFeatures(id)
  const problems: string[] = []
  const path = pathError(avatar.right.path, video.right.path)
  const shape = handshapeError(avatar.right.flex, video.right.flex)
  if (path === null) problems.push('signing hand not tracked in the video')
  else if (path > LIMITS.path) problems.push(`hand path off by ${path.toFixed(2)} shoulder widths (limit ${LIMITS.path})`)
  if (shape?.clash.length) problems.push(`handshape: ${shape.clash.join(', ')}`)
  if (avatar.right.region && video.right.region && avatar.right.region !== video.right.region) {
    problems.push(`signed at the ${avatar.right.region}, video signs at the ${video.right.region}`)
  }
  const two: [boolean, boolean] = [!!avatar.left.active, !!video.left.active]
  if (two[0] !== two[1]) problems.push(two[1] ? 'video uses both hands, avatar one' : 'avatar uses both hands, video one')
  return { token, clip: id, ok: !problems.length, problems, path, handshape: shape?.worst ?? null,
    region: [avatar.right.region, video.right.region], twoHanded: two,
    detail: { avatarPath: avatar.right.path, videoPath: video.right.path, avatarFlex: avatar.right.flex, videoFlex: video.right.flex,
      avatarMouth: avatar.face?.mouth_y ?? null, videoMouth: video.face?.mouth_y ?? null } }
}

// ---------------------------------------------------------------- run

type BankPhrase = { id: string; english: string; gloss: string[] }
const phrases = (bank as { phrases: BankPhrase[] }).phrases
const chosen = phrases.slice(0, flag('--all') ? phrases.length : 100).filter(p => !only || only.has(p.id))

if (flag('--calibrate')) {
  // Does each metric pick a sign's own video out of all the others? A metric
  // that cannot is noise, whatever its threshold.
  const tokens = [...new Set(chosen.flatMap(p => p.gloss))].filter(t => !t.startsWith('FS:') && videoFeatures(t))
  const rows: { token: string; ownPath: number; pathRank: number; ownShape: number; shapeRank: number }[] = []
  for (const token of tokens) {
    const avatar = avatarFeatures(token.toLowerCase())
    const scores = tokens.map(v => {
      const video = videoFeatures(v)!
      return { v, path: pathError(avatar.right.path, video.right.path) ?? 9, shape: handshapeError(avatar.right.flex, video.right.flex)?.worst ?? 999 }
    })
    const own = scores.find(s => s.v === token)!
    rows.push({ token, ownPath: own.path, pathRank: scores.filter(s => s.path < own.path).length + 1,
      ownShape: own.shape, shapeRank: scores.filter(s => s.shape < own.shape).length + 1 })
  }
  const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * f)]
  console.log(`signs ${rows.length}`)
  console.log(`path      own error median ${q(rows.map(r => r.ownPath), .5).toFixed(2)}  p80 ${q(rows.map(r => r.ownPath), .8).toFixed(2)}   own video in top 5: ${rows.filter(r => r.pathRank <= 5).length}/${rows.length}`)
  console.log(`handshape own error median ${q(rows.map(r => r.ownShape), .5).toFixed(0)}  p80 ${q(rows.map(r => r.ownShape), .8).toFixed(0)}   own video in top 5: ${rows.filter(r => r.shapeRank <= 5).length}/${rows.length}`)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(new URL('calibration.json', OUT_DIR), JSON.stringify(rows, null, 1))
  process.exit(0)
}

const safety = fs.existsSync(SAFETY) ? JSON.parse(fs.readFileSync(SAFETY, 'utf8')) : null
const BODY_PART = /Head|Eye|Brow|Masseter|Neck|Jaw|Lip|lip|Cheek|Nose|Chin|Mouth|Spine|_Hand|Finger|Forearm|UpperArm/
function safetyFor(id: string): string[] {
  const item = safety?.items?.find((i: { id: string }) => i.id === id)
  if (!item) return ['no safety result (run npm run safety)']
  const out: string[] = []
  for (const f of item.findings as { check: string; level: string; detail: string; value: number }[]) {
    if (f.level !== 'fail') continue
    if (f.check === 'penetration') {
      // The hands brushing the hips while lifting from rest is the idle pose's
      // design, not a signing error; everything else is.
      const into = f.detail.split('→')[1] ?? ''
      if (BODY_PART.test(into)) out.push(`clips ${f.detail} by ${f.value} cm`)
    } else out.push(`${f.check} ${f.value}`)
  }
  return [...new Set(out)].slice(0, 6)
}

const results = chosen.map((phrase, n) => {
  process.stderr.write(`\r[${n + 1}/${chosen.length}] ${phrase.id}`.padEnd(60))
  const signs = phrase.gloss.map(checkSign)
  const body = safetyFor(phrase.id)
  return { n: phrases.indexOf(phrase) + 1, id: phrase.id, english: phrase.english, gloss: phrase.gloss,
    ok: signs.every(s => s.ok) && !body.length, signs, safety: body }
})
process.stderr.write('\n')

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${String(r.n).padStart(3)} ${r.english.padEnd(34)} ${r.gloss.join(' ')}`)
  if (r.ok) continue
  for (const s of r.signs) for (const p of s.problems) if (!s.ok) console.log(`       ${s.token}: ${p}`)
  for (const p of r.safety) console.log(`       body: ${p}`)
}
const passed = results.filter(r => r.ok).length
console.log(`\n${passed}/${results.length} phrases pass`)
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(new URL('report.json', OUT_DIR), JSON.stringify({ limits: LIMITS, passed, total: results.length, results }, null, 1))
console.log('report: artifacts/phrase-verify/report.json')
if (passed < results.length) process.exit(1)

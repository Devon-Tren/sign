/** CPU runner for artifacts/rig-verify/verify.mjs when a browser is unavailable.
 * Only image loading is stubbed: FBX parsing, rest calibration and every bone
 * transform run through the production code. No WebGL context is required. */
import fs from 'node:fs/promises'
import * as THREE from 'three'
import { loadTestSigner } from './rigFixture'
import { applyManualPose, bodyOrigin, rigSnapshot } from '../src/rigPose'
import { motionFor, allSignIds, clipLengthMs, signParams } from '../src/clips'
import { siteError } from '../src/thumbIK'
import type { ArmChain } from '../src/signerRig'

const rig = await loadTestSigner()
const length = (v: readonly number[]) => Math.hypot(...v)
const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - b[i])
const angle = (a: readonly number[], b: readonly number[]) => Math.acos(Math.max(-1,
  Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0) / (length(a) * length(b) || 1)))) * 57.3
function settle(pose: ReturnType<typeof motionFor>, at: number) {
  for (let k = 0; k < 45; k++) applyManualPose(rig, pose, at, 1 / 30)
  rig.root.updateMatrixWorld(true)
}
settle(motionFor('idle', 0), 0)
const s0 = rigSnapshot(rig)
const eyeMid = s0.eyes.length ? s0.eyes[0].map((v, i) => (v + s0.eyes[1][i]) / 2) : null
const ids = process.argv[3]?.split(',') ?? allSignIds()
const rows = []
for (const id of ids) {
  const dur = clipLengthMs(id, 'isolated'), p = signParams(id)
  const phases = []
  for (const f of [0.35, 0.55, 0.75]) {
    const t = dur * f / 1000, pose = motionFor(id, t, { mode: 'isolated' })
    settle(pose, t)
    const snap = rigSnapshot(rig)
    if (process.argv[4]) {
      await fs.mkdir(process.argv[4], { recursive: true })
      const geometry = rig.mesh.geometry
      const v = new THREE.Vector3()
      const positions = Array.from({ length: geometry.attributes.position.count }, (_, i) => {
        rig.mesh.getVertexPosition(i, v).applyMatrix4(rig.mesh.matrixWorld)
        return v.toArray()
      })
      const skin = geometry.attributes.skinIndex
      const names = rig.mesh.skeleton.bones.map(b => b.name)
      const regions = Array.from({ length: positions.length }, (_, i) =>
        /Head|Neck|Forearm|Hand|Finger/.test(names[skin.getX(i)]) ? 1 : 0)
      await fs.writeFile(
        `${process.argv[4]}/${id}-${f}.json`, JSON.stringify({ positions,
          indices: geometry.index ? Array.from(geometry.index.array) : positions.map((_, i) => i), regions, snap,
          origin: bodyOrigin(rig).toArray(), reach: rig.right.upperLen + rig.right.foreLen }))
    }
    const arm = (req: typeof pose.rightArm, sol: typeof snap.right,
      hand: typeof pose.rightHand, chain: ArmChain) => {
      if (!req) return null
      const tip = sol.distalJoints.reduce((a, b) => a.map((v, i) => v + b[i] / sol.distalJoints.length), [0, 0, 0])
      return {
        reachErr: +length(sub(req.target, sol.wrist)).toFixed(3),
        palmErr: +angle(req.palm, sol.palm).toFixed(1),
        pointErr: +angle(req.point, sol.point).toFixed(1),
        wrist: sol.wrist.map(v => +v.toFixed(3)), tip: tip.map(v => +v.toFixed(3)),
        tipToEyes: eyeMid ? +length(sub(tip, eyeMid)).toFixed(3) : null,
        contact: !!req.contact,
        wristBend: (() => {
          const fore = chain.fore.getWorldPosition(new THREE.Vector3())
          const wrist = chain.hand.getWorldPosition(new THREE.Vector3())
          const mcp = chain.fingers[1].bones[0].getWorldPosition(new THREE.Vector3())
          return +(wrist.clone().sub(fore).angleTo(mcp.sub(wrist)) * 57.3).toFixed(1)
        })(),
        thumbErr: hand.thumb.site ? +siteError(chain, hand.thumb.site).toFixed(3) : null,
        // Additional geometry for front/side skeleton review.
        shoulder: sol.shoulder, elbow: sol.elbow, palm: sol.palm, point: sol.point,
      }
    }
    phases.push({ f, right: arm(pose.rightArm, snap.right, pose.rightHand, rig.right),
      left: arm(pose.leftArm, snap.left, pose.leftHand, rig.left) })
  }
  rows.push({ id, loc: p?.MinorLocation ?? p?.MajorLocation ?? null,
    major: p?.MajorLocation ?? null, hs: p?.Handshape ?? null, type: p?.SignType ?? null,
    contact: p?.Contact ?? null, phases })
}
await fs.writeFile(process.argv[2] ?? 'verify.json', JSON.stringify({ eyeMid, head: s0.head, rows }))
console.log('signs', rows.length, 'eyeMid', eyeMid, 'head', s0.head)

import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadTestSigner } from './rigFixture'
import { torsoFrontZ } from '../src/anchors'
import { applyManualPose, directionToWorld, rigSnapshot } from '../src/rigPose'
import { allSignIds, clipLengthMs, motionFor, signParams } from '../src/clips'

test('zero and nonfinite directions produce a finite unit vector', () => {
  for (const value of [[0, 0, 0], [NaN, 0, 1], [Infinity, 0, 1]] as const) {
    assert.equal(directionToWorld(value, new THREE.Vector3()).length(), 1)
  }
})

test('production FBX reaches database targets within anatomical limits', async () => {
  const rig = await loadTestSigner()
  const errors: number[] = [], forehead: number[] = [], fingertips: number[] = []
  const angle = (a: readonly number[], b: readonly number[]) => Math.acos(THREE.MathUtils.clamp(
    a.reduce((s, v, i) => s + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b)), -1, 1)) * 180 / Math.PI
  let maxReach = 0
  const reachErrors: number[] = []
  for (const id of allSignIds()) {
    let worst = 0
    for (const phase of [.35, .55, .75]) {
      const t = clipLengthMs(id) * phase / 1000, pose = motionFor(id, t)
      for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
      const snap = rigSnapshot(rig)
      for (const side of ['right', 'left'] as const) {
        const req = side === 'right' ? pose.rightArm : pose.leftArm
        if (!req) continue
        // A contact-point target is for part of the hand, not the wrist.
        const w = req.reach ?? {}, total = (w.tip ?? 0) + (w.thumb ?? 0) + (w.palm ?? 0)
        const solved = total > 1e-6
          ? [0, 1, 2].map(k => ((w.tip ?? 0) * snap[side].tip[k] + (w.thumb ?? 0) * snap[side].thumbTip[k]
            + (w.palm ?? 0) * snap[side].palmCentre[k]) / total)
          : snap[side].wrist
        const error = Math.hypot(...req.target.map((v, i) => v - solved[i]))
        // Wrist targets authored inside the torso are pushed out by design
        // (rigPose keepOutOfTorso); they cannot be reached exactly.
        const [tx, ty, tz] = req.target
        const guarded = Math.abs(tx) <= 0.32 && ty <= 0.12 && tz < torsoFrontZ(ty) + 0.05
        if (total > 1e-6) reachErrors.push(error); else if (!guarded) maxReach = Math.max(maxReach, error)
        if (side === 'right') worst = Math.max(worst, angle(req.palm, snap[side].palm))
        const arm = rig[side]
        const wristAngle = arm.hand.quaternion.angleTo(arm.restQ.hand)
        assert.ok(wristAngle <= (req.wristMax ?? .96) + .002, `${id} ${side}: wrist ${wristAngle}`)
        const foreWorld = arm.fore.getWorldQuaternion(new THREE.Quaternion())
        const neutralPalm = new THREE.Vector3().crossVectors(arm.ikUpper, arm.ikFore).multiplyScalar(arm.side).normalize()
        const forePalm = new THREE.Vector3(0, 0, 1).applyQuaternion(arm.foreBasisInv.clone().invert()).applyQuaternion(foreWorld)
        const twist = -arm.side * Math.atan2(new THREE.Vector3().crossVectors(neutralPalm, forePalm).dot(arm.ikFore), neutralPalm.dot(forePalm))
        // ~1 degree of slack: re-aiming the forearm after its rate-limited
        // twist, under a torso that now moves (./body), can overshoot slightly.
        assert.ok(twist >= -85 * Math.PI / 180 - .02 && twist <= Math.PI / 2 + .02,
          `${id} ${side}: forearm ${twist * 180 / Math.PI}`)
      }
    }
    errors.push(worst)
    if (signParams(id)?.MinorLocation === 'Forehead') forehead.push(worst)
    if (signParams(id)?.MinorLocation === 'FingerTip') fingertips.push(worst)
  }
  const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)]
  assert.ok(maxReach < .0005, `max reach ${maxReach}`)
  // Contact points land on their target except where the torso guard holds the
  // wrist off the chest; the median must be essentially exact.
  assert.ok(median(reachErrors) < .01, `contact median ${median(reachErrors)}`)
  assert.ok(median(errors) < 8, `median ${median(errors)}`)
  assert.ok(median(forehead) < 15, `Forehead ${median(forehead)}`)
  assert.ok(median(fingertips) < 15, `FingerTip ${median(fingertips)}`)
  // Contact points on the body surface and a natural elbow (swivel cost)
  // deliberately trade a few degrees of palm on hard cases for a realistic
  // arm: ~36/1286 signs sit 30-54 degrees off (median 0). They are mostly
  // open-8/5 hands on the chest and a few two-handed relations (LEARN, HELP,
  // SINCE) whose ORIENTATION DATA needs review, not a looser solver.
  assert.ok(errors.filter((v) => v > 30).length < 45, `palm >30: ${errors.filter((v) => v > 30).length}`)
})


test('introduction reaches chest and crosses two-finger hands with 70–90 degree elbows', async () => {
  const rig = await loadTestSigner()
  const settle = (id: string, t: number) => {
    const pose = motionFor(id, t)
    for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
    return rigSnapshot(rig)
  }
  const chest = settle('my', .8).right.palmCentre
  assert.ok(Math.abs(chest[2] - .30) < .025, `palm must touch chest: ${chest}`)
  for (const t of [.55, .9, 1.2]) {
    const snap = settle('name', t)
    for (const side of ['right', 'left'] as const) {
      const arm = snap[side]
      const upper = new THREE.Vector3(...arm.shoulder).sub(new THREE.Vector3(...arm.elbow))
      const fore = new THREE.Vector3(...arm.wrist).sub(new THREE.Vector3(...arm.elbow))
      const degrees = upper.angleTo(fore) * 180 / Math.PI
      assert.ok(degrees >= 70 && degrees <= 90, `${side} elbow: ${degrees}`)
    }
    const crossing = new THREE.Vector3(...snap.right.point).angleTo(new THREE.Vector3(...snap.left.point)) * 180 / Math.PI
    assert.ok(crossing >= 70 && crossing <= 90, `finger crossing: ${crossing}`)
  }
})


test('his points forward with an open elbow and T thumb emerges between index and middle', async () => {
  const rig = await loadTestSigner()
  const settle = (id: string, t: number) => {
    const pose = motionFor(id, t)
    for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
    return { pose, arm: rigSnapshot(rig).right }
  }
  const { arm } = settle('his', .8)
  const elbow = new THREE.Vector3(...arm.elbow)
  const bend = new THREE.Vector3(...arm.shoulder).sub(elbow)
    .angleTo(new THREE.Vector3(...arm.wrist).sub(elbow)) * 180 / Math.PI
  assert.ok(bend >= 90 && bend < 130, `right elbow: ${bend}`)
  assert.ok(arm.point[2] > .98, `forward point: ${arm.point}`)
  settle('fs:t', .08)
  const index = rig.right.fingers[0].bones[1].getWorldPosition(new THREE.Vector3())
  const middle = rig.right.fingers[1].bones[1].getWorldPosition(new THREE.Vector3())
  const radial = index.clone().sub(middle).normalize()
  const tip = rig.right.thumb.bones.at(-1)!.getWorldPosition(new THREE.Vector3())
  const previous = rig.right.thumb.bones.at(-2)!.getWorldPosition(new THREE.Vector3())
  tip.add(tip.clone().sub(previous).multiplyScalar(.85))
  const across = tip.clone().sub(middle).dot(radial) / index.distanceTo(middle)
  assert.ok(across > .1 && across < .9, `thumb between fingers: ${across}`)
  const knuckles = index.clone().add(middle).multiplyScalar(.5)
  assert.ok(tip.y > knuckles.y, 'thumb must emerge above the folded knuckles')
})

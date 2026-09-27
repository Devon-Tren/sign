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


test('greetings keep middle fingers toward chest and perform each fine contact', async () => {
  const rig = await loadTestSigner()
  const settle = (id: string, phase: number) => {
    const t = clipLengthMs(id, 'continuous') * phase / 1000
    const pose = motionFor(id, t, { mode: 'continuous', skipOnset: true, skipRelease: true })
    for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
    return rigSnapshot(rig)
  }
  const start = settle('whats_up', .15), end = settle('whats_up', .85)
  for (const snap of [start, end]) {
    for (const side of ['right', 'left'] as const) {
      const a = snap[side]
      const upper = new THREE.Vector3(...a.elbow).sub(new THREE.Vector3(...a.shoulder))
      const angle = upper.angleTo(new THREE.Vector3(0, -1, 0)) * 180 / Math.PI
      assert.ok(angle > 20 && angle < 40, `${side} armpit angle ${angle}`)
      assert.ok(a.fingerDirections[1][2] < -.85, `${side} middle finger toward chest`)
    }
  }
  for (const side of ['right', 'left'] as const) {
    assert.ok(end[side].wrist[2] - start[side].wrist[2] > .25)
  }
  for (const phase of [.10, .90]) {
    const a = settle('im_fine', phase).right
    assert.ok(Math.hypot(a.tip[0] - .1, a.tip[1] + .12, a.tip[2] - .29) < .07, `index contact ${a.tip}`)
  }
  const thumb = settle('im_fine', .60).right.thumbTip
  assert.ok(Math.hypot(thumb[0] - .1, thumb[1] + .12, thumb[2] - .29) < .07, `thumb contact ${thumb}`)
})

test('polite signs keep a straight hello wrist, lower thank-you, and rub the chest', async () => {
  const rig = await loadTestSigner()
  const v = (a: readonly number[]) => new THREE.Vector3(...a)
  const settle = (id: string, phase: number) => {
    const t = clipLengthMs(id, 'continuous') * phase / 1000
    const pose = motionFor(id, t, { mode: 'continuous', skipOnset: true, skipRelease: true })
    for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
    return { pose, snap: rigSnapshot(rig) }
  }
  for (const phase of [.1, .5, .85]) {
    const { snap } = settle('hello', phase)
    const arm = rig.right
    const fore = arm.fore.getWorldPosition(new THREE.Vector3())
    const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
    const knuckle = arm.fingers[1].bones[0].getWorldPosition(new THREE.Vector3())
    const bend = wrist.clone().sub(fore).angleTo(knuckle.sub(wrist)) * 180 / Math.PI
    assert.ok(bend < 20, `hello wrist bend ${bend}`)
    assert.ok(snap.right.wrist[1] > .24)
  }
  const start = settle('thank_you', .1).snap
  assert.ok(v(start.right.tip).distanceTo(v([.02, .26, .245])) < .04, `chin contact ${start.right.tip}`)
  let previousY = start.right.wrist[1]
  for (const phase of [.3, .5, .7, .9]) {
    const { snap } = settle('thank_you', phase)
    assert.ok(snap.left.wrist[1] < -.75, 'left hand stays lowered')
    assert.ok(snap.right.palm[2] < -.85, 'palm stays facing the signer')
    assert.ok(snap.right.wrist[1] <= previousY + .001, 'hand moves down')
    assert.ok(Math.abs(snap.right.wrist[0] - start.right.wrist[0]) < .025, 'no sideways sweep')
    previousY = snap.right.wrist[1]
    if (phase === .9) {
      const a = snap.right
      const elbow = v(a.shoulder).sub(v(a.elbow)).angleTo(v(a.wrist).sub(v(a.elbow))) * 180 / Math.PI
      assert.ok(elbow >= 70 && elbow <= 80, `thank-you elbow ${elbow}`)
    }
  }
  const centres: number[][] = []
  for (const phase of [0, .125, .25, .375, .5, .625, .75, .875]) {
    const { pose, snap } = settle('please', phase)
    assert.ok(snap.right.palm[2] < -.98, 'palm parallel to chest')
    assert.ok(v(snap.right.palmCentre).distanceTo(v(pose.rightArm!.target)) < .04, 'palm stays on chest')
    centres.push(snap.right.palmCentre)
  }
  assert.ok(Math.max(...centres.map(p => p[0])) - Math.min(...centres.map(p => p[0])) > .12)
  assert.ok(Math.max(...centres.map(p => p[1])) - Math.min(...centres.map(p => p[1])) > .11)
  assert.ok(v(centres[0]).distanceTo(v(centres[4])) < .015, 'circle returns to start')
})

test('self-point and repeated palm taps reach their targets on the character', async () => {
  const rig = await loadTestSigner()
  const v = (a: readonly number[]) => new THREE.Vector3(...a)
  const settle = (id: string, phase: number) => {
    const t = clipLengthMs(id, 'continuous') * phase / 1000
    const pose = motionFor(id, t, { mode: 'continuous', skipOnset: true, skipRelease: true })
    for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
    return { pose, snap: rigSnapshot(rig) }
  }
  const me = settle('me', .7)
  assert.ok(v(me.snap.right.tip).distanceTo(v([.1, -.12, .29])) < .05)
  assert.ok(me.pose.rightHand.fingers[0].curl.every(c => c === 0))
  assert.ok(me.pose.rightHand.fingers.slice(1).every(f => f.curl[0] > 1))
  for (const id of ['help', 'again']) {
    const lifted = settle(id, .10).snap
    for (const phase of [.33, .9]) {
      const { snap } = settle(id, phase)
      assert.ok(snap.left.palm[1] > .98, `${id} left palm faces up`)
      assert.ok(snap.left.point[2] > .6, `${id} left hand extends outward`)
      const contact = id === 'help' ? snap.right.distalJoints[3] : snap.right.tip
      assert.ok(v(contact).distanceTo(v(snap.left.palmCentre)) < .05, `${id} tap reaches palm centre`)
      assert.ok(lifted.right.wrist[1] - snap.right.wrist[1] > .18, `${id} rises between taps`)
      if (id === 'help') assert.ok(snap.right.thumbTip[1] > snap.right.wrist[1] + .17, 'thumb stays up')
    }
    const secondLift = settle(id, .58).snap
    assert.ok(Math.abs(secondLift.right.wrist[1] - lifted.right.wrist[1]) < .02, `${id} second lift`)
  }
  for (const phase of [.08, .29, .5, .75]) {
    const { snap } = settle('understand', phase)
    assert.ok(snap.right.wrist[0] > .4 && snap.right.wrist[1] > .25, 'fist beside right side of head')
    assert.ok(snap.right.palm[2] < -.98, 'fingers face the signer')
  }
})

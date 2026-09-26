import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadTestSigner } from './rigFixture'
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
  for (const id of allSignIds()) {
    let worst = 0
    for (const phase of [.35, .55, .75]) {
      const t = clipLengthMs(id) * phase / 1000, pose = motionFor(id, t)
      for (let k = 0; k < 45; k++) applyManualPose(rig, pose, t, 1 / 30)
      const snap = rigSnapshot(rig)
      for (const side of ['right', 'left'] as const) {
        const req = side === 'right' ? pose.rightArm : pose.leftArm
        if (!req) continue
        maxReach = Math.max(maxReach, Math.hypot(...req.target.map((v, i) => v - snap[side].wrist[i])))
        if (side === 'right') worst = Math.max(worst, angle(req.palm, snap[side].palm))
        const arm = rig[side]
        const wristAngle = arm.hand.quaternion.angleTo(arm.restQ.hand)
        assert.ok(wristAngle <= (req.wristMax ?? .96) + .002, `${id} ${side}: wrist ${wristAngle}`)
        const foreWorld = arm.fore.getWorldQuaternion(new THREE.Quaternion())
        const neutralPalm = new THREE.Vector3().crossVectors(arm.ikUpper, arm.ikFore).multiplyScalar(arm.side).normalize()
        const forePalm = new THREE.Vector3(0, 0, 1).applyQuaternion(arm.foreBasisInv.clone().invert()).applyQuaternion(foreWorld)
        const twist = -arm.side * Math.atan2(new THREE.Vector3().crossVectors(neutralPalm, forePalm).dot(arm.ikFore), neutralPalm.dot(forePalm))
        assert.ok(twist >= -85 * Math.PI / 180 - .01 && twist <= Math.PI / 2 + .01,
          `${id} ${side}: forearm ${twist * 180 / Math.PI}`)
      }
    }
    errors.push(worst)
    if (signParams(id)?.MinorLocation === 'Forehead') forehead.push(worst)
    if (signParams(id)?.MinorLocation === 'FingerTip') fingertips.push(worst)
  }
  const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)]
  assert.ok(maxReach < .0005, `max reach ${maxReach}`)
  assert.ok(median(errors) < 8, `median ${median(errors)}`)
  assert.ok(median(forehead) < 15, `Forehead ${median(forehead)}`)
  assert.ok(median(fingertips) < 15, `FingerTip ${median(fingertips)}`)
  assert.ok(errors.filter(v => v > 30).length < 20)
})

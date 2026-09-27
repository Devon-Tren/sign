import assert from 'node:assert/strict'
import test from 'node:test'
import { allSignIds, augmentFor, clipLengthMs, handshapeFor, motionFor, signParams } from '../src/clips'
import { acceptedDirection, phonoPriorFor, pointForPalm, type DirectionEvidence } from '../src/phono'
import { auditReport, internalMovement, priorUsage } from '../src/audit'
import { authoredClipFor } from '../src/authored'
import { offlinePlan } from '../src/offlinePlan'
import { playbackPlan, poseAt } from '../src/playback'
import { ORIENTATION_BY_LOCATION } from '../src/anchors'
import { FINGERSPELL } from '../src/handshapes'
import './rig.test'
import './practiceGrading.test'
import { learningItem } from '../src/learning'
import { orientationFor } from '../src/anchors'

const evidence = (votes: number, observations: number): DirectionEvidence => ({
  direction: 'up', vector: [0, 1, 0], votes, observations, consensus: votes / observations,
  mean_confidence: 0.99, supporting_samples: 2, accepted: true,
})

test('strict gate rejects ties, corrupt evidence and invalid vectors', () => {
  assert.equal(acceptedDirection(evidence(5, 10)), null)
  assert.equal(acceptedDirection(evidence(0, 0)), null)
  assert.equal(acceptedDirection(evidence(11, 10)), null)
  assert.equal(acceptedDirection({ ...evidence(6, 10), vector: [0, 0, 0] }), null)
  assert.equal(acceptedDirection({ ...evidence(6, 10), vector: [NaN, 0, 0] }), null)
  assert.deepEqual(acceptedDirection(evidence(6, 10)), [0, 1, 0])
})

test('parallel finger and palm axes produce a finite orthonormal basis', () => {
  for (const palm of [[0, 1, 0], [0, 0, 1], [1, 0, 0]] as const) {
    const point = pointForPalm(palm, palm)
    assert.ok(Math.abs(Math.hypot(...point) - 1) < 1e-6)
    assert.ok(Math.abs(point.reduce((sum, v, i) => sum + v * palm[i], 0)) < 1e-6)
  }
})

test('generated and blended stroke frames preserve palm normals with perpendicular pointing', () => {
  for (const id of allSignIds()) {
    const p = signParams(id)
    // Lexicalised fingerspelling uses a separate, letter-specific path.
    if (p?.FingerspelledLoanSign === '1') continue
    for (const phase of [0.12, 0.35, 0.55, 0.75, 0.93]) {
      const pose = motionFor(id, clipLengthMs(id) * phase / 1000)
      for (const arm of [pose.rightArm, pose.leftArm]) {
        if (!arm) continue
        assert.ok(Math.abs(arm.palm.reduce((s, v, i) => s + v * arm.point[i], 0)) < 1e-6, id)
      }
    }
  }
})

test('thumb-to-head family rule is descriptor based and excludes other 5-hand head signs', () => {
  for (const id of ['father', 'mother', 'parents', 'grandfather', 'man', 'woman']) {
    const p = signParams(id)!
    const m = p.morphemes?.[0] ?? p
    assert.deepEqual(orientationFor(m.MajorLocation, m.SecondMinorLocation, m).palm, [-1, 0, 0], id)
  }
  for (const id of ['color', 'hate', 'memorize', 'ocean']) {
    const m = signParams(id)!
    assert.notDeepEqual(orientationFor(m.MajorLocation, m.SecondMinorLocation, m).palm, [-1, 0, 0], id)
  }
})

test('citation overrides reach playback and contact relations respect explicit orientation', () => {
  for (const [id, palm] of [['what', [0, 1, 0]], ['must', [0, -1, 0]], ['more', [-1, 0, 0]]] as const) {
    assert.deepEqual(motionFor(id, clipLengthMs(id) * .55 / 1000).rightArm!.palm, palm)
    assert.ok(augmentFor(id).orientation_note?.startsWith('Citation') || augmentFor(id).orientation_note)
  }
  assert.ok(motionFor('thank_you', clipLengthMs('thank_you') * .75 / 1000).rightArm!.palm[2] < 0)
  const help = motionFor('help', clipLengthMs('help') * .55 / 1000).rightArm!
  // The authored thumb-up hammer takes precedence over the older HELP prior.
  assert.deepEqual(help.palm, [-1, 0, 0])
})

test('all signs retain ASL-LEX handshape, location anchors and timing', () => {
  for (const id of allSignIds()) {
    for (const mode of ['isolated', 'continuous'] as const) {
      const at = clipLengthMs(id, mode) * 0.45 / 1000
      const enabled = motionFor(id, at, { mode })
      const disabled = motionFor(id, at, { mode, usePhonoPriors: false })
      assert.deepEqual(enabled.rightHand, disabled.rightHand, id)
      assert.deepEqual(enabled.leftHand, disabled.leftHand, id)
      assert.equal(enabled.browRaise, disabled.browRaise, id)
      assert.equal(enabled.browFurrow, disabled.browFurrow, id)
      assert.equal(enabled.mouth, disabled.mouth, id)
      const sign = signParams(id)!
      if ((sign.morphemes?.length ?? 1) > 1 || sign.FingerspelledLoanSign === '1') {
        assert.deepEqual(enabled, disabled, id)
      }
      const a = augmentFor(id)
      if (a.orientation || a.orientation_end) {
        assert.deepEqual(enabled.rightArm?.palm, disabled.rightArm?.palm, id)
      }
      if (sign.SecondMinorLocation && sign.SecondMinorLocation !== 'NA'
          && sign.SecondMinorLocation !== sign.MinorLocation) {
        assert.deepEqual(enabled.rightArm?.target, disabled.rightArm?.target, id)
      }
    }
  }
})

test('accepted orientation changes the actual rendered palm, with no double rotation', () => {
  let checked = 0
  for (const id of allSignIds()) {
    if (!priorUsage(id).orientation) continue
    const prior = acceptedDirection(phonoPriorFor(id)?.orientation_dh)!
    const arm = motionFor(id, clipLengthMs(id) * 0.45 / 1000).rightArm!
    assert.ok(Math.hypot(...arm.palm.map((v, i) => v - prior[i])) < 1e-6, id)
    assert.ok(Math.abs(arm.point.reduce((s, v, i) => s + v * arm.palm[i], 0)) < 1e-6, id)
    checked++
  }
  assert.ok(checked > 50, 'prior stopped reaching playback')
})

test('HIGH moves upward in signer space and symmetric local paths move both wrists', () => {
  assert.equal(phonoPriorFor('high')?.movement_dh?.direction, 'up')
  const start = motionFor('high', 0.18).rightArm!.target
  const end = motionFor('high', 0.65).rightArm!.target
  assert.ok(end[1] > start[1])
  assert.ok(Math.abs(end[0] - start[0]) < 1e-6)
  for (const id of allSignIds()) {
    if (!priorUsage(id).movement || signParams(id)?.SignType !== 'SymmetricalOrAlternating') continue
    const p = motionFor(id, 0.45)
    assert.ok(Math.abs(p.rightArm!.target[0] + p.leftArm!.target[0]) < 1e-6, id)
    assert.ok(Math.abs(p.rightArm!.target[1] - p.leftArm!.target[1]) < 1e-6, id)
  }
})

test('catalog audit separates internal motion and catches invalid poses', () => {
  const report = auditReport()
  assert.equal(report.handshapeCollisions.length, 0)
  assert.equal(report.fingerspellCollisions.length, 0)
  assert.equal(report.byKind['invalid-pose'] ?? 0, 0)
  assert.ok(report.phonoOrientationApplied > 50)
  assert.ok(report.phonoMovementApplied > 0)
  assert.ok(report.pathFreeInternal > 0)
  for (const issue of report.issues.filter(i => i.kind === 'path-free-internal-movement')) {
    assert.ok(internalMovement(issue.sign))
  }
})

test('greeting keyframes use straight B hands and keep MORNING beside the face', () => {
  const hello = authoredClipFor('hello')!
  const good = authoredClipFor('good')!
  const morning = authoredClipFor('morning')!
  assert.equal(good.right_handshape, 'b')
  assert.equal(good.left_handshape, 'b')
  assert.equal(morning.right_handshape, 'b')
  assert.equal(morning.left_handshape, 'b')

  const helloContact = hello.keyframes.find(f => f.phase === 'fingertips at brow')!
  assert.ok(helloContact.right.elbow![1] < 0 && helloContact.right.elbow![2] > 0.9)

  const start = morning.keyframes.find(f => f.phase === 'right chest')!
  const middle = morning.keyframes.find(f => f.phase === 'rising beside face')!
  const end = morning.keyframes.find(f => f.phase === 'face height')!
  assert.ok(start.right.target[1] > -0.25 && start.right.target[2] > 0.5)
  assert.ok(middle.right.target[1] > start.right.target[1])
  assert.ok(end.right.target[0] > start.right.target[0])
  assert.ok(end.right.target[1] > 0.2 && end.right.target[2] < 0.25)
  assert.ok(start.right.point[2] > 0.99 && end.right.point[1] > 0.99)
  assert.deepEqual(start.right.elbow, end.right.elbow)
  assert.ok(end.left!.target[1] > start.left!.target[1])
  assert.ok(end.left!.target[2] > start.left!.target[2])
})

test('rest fan closes B while explicit spread opens away from the middle', () => {
  const closed = handshapeFor('b').fingers.map(f => f.spread)
  const spread = handshapeFor('5').fingers.map(f => f.spread)
  assert.ok(closed[0] > 0 && closed[1] > 0 && closed[2] < 0 && closed[3] < 0)
  assert.ok(spread[0] < 0 && spread[1] < 0 && spread[2] > 0 && spread[3] > 0)
})

test('GOOD MORNING expands into two continuous lexical clips', () => {
  const planned = offlinePlan('Good morning')!.timeline
  assert.deepEqual(planned.clips.map(c => c.clip_id), ['good', 'morning'])
  // poseAt takes time in the PLAYED plan (planner clips + scheduled transitions).
  const boundary = playbackPlan(planned).clips[0].end_ms
  const before = poseAt(planned, boundary - 0.01)
  const after = poseAt(planned, boundary)
  assert.ok(Math.hypot(...before.rightArm!.target.map((v, i) => v - after.rightArm!.target[i])) < 0.001)
})

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const turn = (a: readonly number[], b: readonly number[]) =>
  Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))))

test('played plans move at human speed: no impossible transitions between signs', () => {
  // Root cause R1: transitions used to be squeezed into ~170 ms inside the sign
  // (7-13 arm-reach/s, ~26 rad/s palms). They are now scheduled explicitly.
  for (const text of ['Hello. Good morning.', 'Thank you very much', 'My mother and father', 'Where is the bathroom']) {
    const plan = playbackPlan(offlinePlan(text)!.timeline)
    let prev = poseAt(plan, 0)
    for (let ms = 1000 / 120; ms < plan.duration_ms; ms += 1000 / 120) {
      const pose = poseAt(plan, ms)
      const inside = plan.clips.some(c => ms > c.start_ms && ms < c.end_ms)
      if (!inside && pose.rightArm && prev.rightArm) {
        assert.ok(dist(pose.rightArm.target, prev.rightArm.target) * 120 < 3.4, `${text} transition speed at ${ms}`)
        assert.ok(turn(pose.rightArm.palm, prev.rightArm.palm) * 120 < 18, `${text} transition turn at ${ms}`)
      }
      prev = pose
    }
  }
})

test('repeated straight signs repeat their path', () => {
  // Root cause R3: Straight + RepeatedMovement signs moved exactly once.
  for (const id of ['mother', 'more']) {
    const dur = clipLengthMs(id, 'continuous')
    const opts = { mode: 'continuous' as const, durationMs: dur, skipOnset: true, skipRelease: true }
    const ys: number[] = []
    for (let ms = 0; ms < dur; ms += 5) {
      const a = motionFor(id, ms / 1000, opts).rightArm!
      ys.push(a.target[0] + a.target[1] * 3 + a.target[2] * 7)
    }
    let reversals = 0
    for (let i = 2; i < ys.length; i++) if ((ys[i] - ys[i - 1]) * (ys[i - 1] - ys[i - 2]) < -1e-12) reversals++
    assert.ok(reversals >= 2, `${id} reversals ${reversals}`)
  }
})

test('no orientation data hands the solver a degenerate palm/finger frame', () => {
  // P, Q, G, H and ME were each coded with palm and fingers (nearly) parallel,
  // which left the finger direction undefined and flipped the hand.
  const pairs: [string, readonly number[], readonly number[]][] = [
    ...Object.entries(ORIENTATION_BY_LOCATION).map(([k, v]) => [k, v.palm, v.point] as [string, readonly number[], readonly number[]]),
    ...Object.entries(FINGERSPELL).map(([k, v]) => [`letter ${k}`, v.palm, v.point] as [string, readonly number[], readonly number[]]),
    ...allSignIds().flatMap(id => {
      const o = (augmentFor(id) as { orientation?: { palm: number[]; point: number[] } }).orientation
      return o ? [[id, o.palm, o.point] as [string, readonly number[], readonly number[]]] : []
    }),
  ]
  for (const [name, palm, point] of pairs) assert.ok(Math.abs(Math.cos(turn(palm, point))) < 0.7, name)
})

test('fingerspelled words change letters smoothly', () => {
  for (const word of ['half', 'no', 'opportunity']) {
    let prev = motionFor(`fs:${word}`, 0).rightArm!
    for (let t = 1 / 120; t < word.length * 0.36; t += 1 / 120) {
      const a = motionFor(`fs:${word}`, t).rightArm!
      assert.ok(turn(a.point, prev.point) < 0.45, `${word} finger step at ${t.toFixed(3)}`)
      prev = a
    }
  }
})

test('handshape codes compose as ASL-LEX defines them', () => {
  // closed_b is a straight B (thumb closed), not a fist.
  assert.deepEqual([...handshapeFor('closed_b').fingers[0].curl], [0, 0, 0])
  // F, 8 and 7 curve their contact finger to the thumb instead of folding it away.
  assert.ok(handshapeFor('f').fingers[0].curl[0] < 0.8)
  assert.ok(handshapeFor('8').fingers[1].curl[0] < 0.8)
  // Folded and opposed thumbs are placed by position (./thumbIK).
  for (const name of ['closed_b', 's', '1', 'o', 'f', 't', 'a']) assert.ok(handshapeFor(name).thumb.site, name)
  assert.equal(handshapeFor('5').thumb.site, undefined)
})


test('introduction plays HELLO MY NAME then each letter of HECTOR', () => {
  const plan = offlinePlan('Hello, my name is Hector.')!
  assert.deepEqual(plan.timeline.clips.map(c => c.clip_id), ['hello', 'my', 'name', 'fs:hector'])
  for (const [i, letter] of [...'HECTOR'].entries()) {
    const pose = motionFor('fs:hector', i * .36 + .04)
    assert.deepEqual(pose.rightHand, handshapeFor(FINGERSPELL[letter].shape))
  }
  const name = motionFor('name', 1.1)
  assert.deepEqual(name.rightHand, handshapeFor('h'))
  assert.deepEqual(name.leftHand, handshapeFor('h'))
})


test('his introduction keeps the requested forward point before NAME and HECTOR', () => {
  const plan = offlinePlan('His name is Hector.')!
  assert.deepEqual(plan.timeline.clips.map(c => c.clip_id), ['his', 'name', 'fs:hector'])
  const pose = motionFor('his', .8)
  assert.deepEqual(pose.rightHand, handshapeFor('1'))
  assert.deepEqual(pose.rightArm!.point, [0, 0, 1])
})


test('new greeting expressions select complete authored motions offline', () => {
  for (const text of ["what's up", 'What’s up?', 'whats up', 'what is up']) {
    assert.deepEqual(offlinePlan(text)!.timeline.clips.map(c => c.clip_id), ['whats_up'])
  }
  for (const text of ["I'm fine", 'I’m fine.', 'I am fine']) {
    assert.deepEqual(offlinePlan(text)!.timeline.clips.map(c => c.clip_id), ['im_fine'])
  }
  assert.deepEqual(offlinePlan('Her name is Hector.')!.timeline.clips.map(c => c.clip_id), ['his', 'name', 'fs:hector'])
  const clip = authoredClipFor('im_fine')!
  for (const frame of clip.keyframes) {
    const pose = motionFor('im_fine', frame.at * 2.75, { mode: 'continuous', skipOnset: true, skipRelease: true })
    if (frame.at < 1) assert.deepEqual(pose.rightHand, handshapeFor(frame.right_handshape))
  }
})

test('hello keeps its original salute path and timing after wrist correction', () => {
  const hello = authoredClipFor('hello')!
  assert.deepEqual(hello.duration_ms, { isolated: 1600, continuous: 1150 })
  assert.deepEqual(hello.keyframes.map(f => [f.at, f.right.target]), [
    [0, [.34, .25, .17]], [.22, [.34, .25, .17]],
    [.72, [.54, .28, .4]], [1, [.54, .28, .4]],
  ])
})

test('understand raises the index twice with two subtle nods', () => {
  let previousRaised = false, rises = 0
  let previousNodding = false, nods = 0
  for (let i = 0; i < 200; i++) {
    const pose = motionFor('understand', i / 100, { mode: 'continuous', skipOnset: true, skipRelease: true })
    const raised = pose.rightHand.fingers[0].curl[0] < .1
    const nodding = pose.head[0] < -.07
    if (raised && !previousRaised) rises++
    if (nodding && !previousNodding) nods++
    assert.ok(pose.rightHand.fingers.slice(1).every(f => f.curl[0] > 1), 'other fingers stay in fist')
    assert.ok(pose.head[0] >= -.1 && pose.head[0] <= 0, 'nod stays subtle and tilts down')
    previousRaised = raised; previousNodding = nodding
  }
  assert.equal(rises, 2)
  assert.equal(nods, 2)
})

test('help and again each make exactly two downward taps', () => {
  for (const id of ['help', 'again']) {
    let contacts = 0, previousContact = false
    for (let i = 0; i < 200; i++) {
      const pose = motionFor(id, clipLengthMs(id, 'continuous') * i / 200000,
        { mode: 'continuous', skipOnset: true, skipRelease: true })
      const contact = pose.rightArm!.target[1] < (id === 'help' ? -.29 : -.34)
      if (contact && !previousContact) contacts++
      previousContact = contact
    }
    assert.equal(contacts, 2, id)
  }
})


test('two-hand coordination uses its own open-palm warm-up', () => {
  assert.equal(learningItem('two-open').animationId, 'two_open')
  assert.equal(authoredClipFor('learn'), null, 'warm-up must not replace LEARN')
  for (const phase of [.1, .5, .85]) {
    const pose = motionFor('two_open', phase * 1.75, { mode: 'continuous', skipOnset: true, skipRelease: true })
    for (const hand of [pose.rightHand, pose.leftHand]) {
      assert.ok(hand.fingers.every(f => f.curl.every(c => c === 0)), 'both hands remain open')
    }
  }
})

test('question raises the index and curls it twice with a puzzled expression', () => {
  let curls = 0, previousCurled = false
  for (let i = 0; i < 200; i++) {
    const pose = motionFor('question', i / 100, { mode: 'continuous', skipOnset: true, skipRelease: true })
    const curled = pose.rightHand.fingers[0].curl[1] > .7
    if (curled && !previousCurled) curls++
    previousCurled = curled
    assert.ok(pose.rightHand.fingers.slice(1).every(f => f.curl[0] > 1))
    assert.ok(pose.browFurrow >= .6 && pose.browRaise > 0, 'confused brow expression')
    assert.ok(pose.head[2] > 0 && pose.head[2] < .1, 'small questioning head tilt')
  }
  assert.equal(curls, 2)
})


test('YES repeats a wrist nod while WHERE and BATHROOM keep their handshapes', () => {
  const yes = authoredClipFor('yes')!
  assert.equal(yes.right_handshape, 's')
  const axes = yes.keyframes.map(f => f.right.point![2])
  const reversals = axes.slice(2).filter((v, i) => (v - axes[i + 1]) * (axes[i + 1] - axes[i]) < -1e-9)
  assert.ok(reversals.length >= 2, 'YES needs repeated wrist nods')
  for (const frame of yes.keyframes) assert.deepEqual(frame.right.target, yes.keyframes[0].right.target)
  for (const [id, shape] of [['where', '1'], ['bathroom', 't']]) {
    const clip = authoredClipFor(id)!
    assert.equal(clip.right_handshape, shape)
    assert.ok(clip.keyframes.every(f => !f.right_handshape || f.right_handshape === shape))
    const xs = clip.keyframes.map(f => f.right.point![0])
    assert.ok(Math.min(...xs) < -.15 && Math.max(...xs) > .15, `${id} pivots both ways`)
  }
  assert.ok(authoredClipFor('where')!.expression!.browFurrow! > .4)
})

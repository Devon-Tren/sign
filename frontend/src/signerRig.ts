/**
 * Loads the Microsoft Rocketbox signer (MIT licensed - see NOTICE) and wraps
 * its skeleton in a rig that the pose schema in ./clips can drive.
 *
 * The model is a 3ds Max Biped: bone local axes do not follow any convention we
 * can assume, so every rotation here is applied RELATIVE TO THE REST POSE and
 * the finger curl axes are calibrated from the mesh at load time rather than
 * hardcoded.
 */
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const MODEL_URL = '/avatar/signer.fbx'
const TEXTURES: Record<string, { color: string; normal?: string; rough?: string }> = {
  f014_body: {
    color: '/avatar/f014_body_color.webp',
    normal: '/avatar/f014_body_normal.webp',
    rough: '/avatar/f014_body_rough.webp',
  },
  f014_head: {
    color: '/avatar/f014_head_color.webp',
    normal: '/avatar/f014_head_normal.webp',
    rough: '/avatar/f014_head_rough.webp',
  },
  f014_opacity: { color: '/avatar/f014_opacity_color.webp' },
}

/** Target on-screen height, matching the previous primitive avatar. */
export const SIGNER_HEIGHT = 3.2

/**
 * The mesh ships 175 blend shapes (ARKit, FACS action units, visemes and two
 * tracker sets). Each one is a full copy of 26,898 vertex positions, so
 * uploading all of them costs well over 100MB of GPU memory for no benefit.
 * Keep only the non-manual markers the pose schema actually drives.
 *
 * ASL grammar lives on these: AU 1+2 is the brow raise that marks yes/no
 * questions, AU 4 the furrow that marks WH-questions.
 */
const USED_MORPHS = [
  // Blinking: the eyelid BONES only half-close this rig's eyes, so the authored
  // ARKit blink shapes do the work and the bones add the surrounding skin motion.
  'AK_09_EyeBlinkLeft',
  'AK_10_EyeBlinkRight',
  'AU_01_InnerBrowRaiser',
  'AU_02_OuterBrowRaiser',
  'AU_02_L_OuterBrowRaiser',
  'AU_02_R_OuterBrowRaiser',
  'AU_04_BrowLowerer',
  'AK_25_JawOpen',
  'AK_19_EyeSquintLeft',
  'AK_20_EyeSquintRight',
]

/** Drop every blend shape we do not drive, before the geometry reaches the GPU. */
function pruneMorphs(mesh: THREE.SkinnedMesh) {
  const dict = mesh.morphTargetDictionary
  const attrs = mesh.geometry.morphAttributes
  if (!dict || !attrs.position) return
  const keep: { name: string; index: number }[] = []
  for (const short of USED_MORPHS) {
    for (const full of Object.keys(dict)) {
      if (full.replace(/^blendShape1\./, '') === short) keep.push({ name: short, index: dict[full] })
    }
  }
  if (!keep.length) return
  const position = keep.map((k) => attrs.position[k.index])
  const normal = attrs.normal ? keep.map((k) => attrs.normal[k.index]) : undefined
  mesh.geometry.morphAttributes.position = position
  if (normal) mesh.geometry.morphAttributes.normal = normal
  mesh.morphTargetDictionary = Object.fromEntries(keep.map((k, i) => [k.name, i]))
  mesh.morphTargetInfluences = keep.map(() => 0)
}

export type FingerChain = {
  bones: THREE.Bone[]
  /** Flexion axis in each bone's own local space. */
  curlAxis: THREE.Vector3[]
  restQ: THREE.Quaternion[]
  /** Abduction axis (spread) for the first joint only. */
  spreadAxis: THREE.Vector3
  /** The first bone's own long axis, used for thumb opposition. */
  longAxis: THREE.Vector3
}

export type ArmChain = {
  upper: THREE.Bone
  fore: THREE.Bone
  hand: THREE.Bone
  /** index, middle, ring, pinky */
  fingers: FingerChain[]
  thumb: FingerChain
  upperLen: number
  foreLen: number
  restQ: { upper: THREE.Quaternion; fore: THREE.Quaternion; hand: THREE.Quaternion }
  /** Direction each bone points in its own local frame, at rest. */
  axis: { upper: THREE.Vector3; fore: THREE.Vector3 }
  /** Forearm aim target from the IK, before pronation is folded in. */
  foreAim: THREE.Quaternion
  /** Critically-damped follower for the IK target, see smoothTarget. */
  smooth: { pos: THREE.Vector3; vel: THREE.Vector3; started: boolean }
  /** Hand frame at rest, in world space. */
  palmNormal: THREE.Vector3
  across: THREE.Vector3
  along: THREE.Vector3
  /** The hand bone's world rotation at rest, and the rest hand basis. */
  handRestWorldQ: THREE.Quaternion
  restBasisQ: THREE.Quaternion
}

/** Head, spine and face bones, with the rest pose and calibrated world axes. */
export type FaceRig = {
  neck?: THREE.Bone
  head?: THREE.Bone
  /** Spine1 and Spine2; torso motion is spread across both so it reads as a spine. */
  spine: THREE.Bone[]
  eyes: THREE.Bone[]
  rest: Map<THREE.Bone, THREE.Quaternion>
  /** World axes at rest: left-to-right through the head, and up. */
  right: THREE.Vector3
  up: THREE.Vector3
  forward: THREE.Vector3
}

export type SignerRig = {
  root: THREE.Group
  mesh: THREE.SkinnedMesh
  left: ArmChain
  right: ArmChain
  face: FaceRig
  morphTargets: Record<string, number>
  morphInfluences: number[]
  /** Shoulder positions in root-local space, for IK targets. */
  shoulder: { left: THREE.Vector3; right: THREE.Vector3 }
}

const bone = (root: THREE.Object3D, name: string): THREE.Bone | undefined =>
  root.getObjectByName(name) as THREE.Bone | undefined

/** Biped finger groups: Finger0 is the thumb, Finger1..4 index..pinky. */
const FINGER_IDS = ['1', '2', '3', '4']

function buildFinger(root: THREE.Object3D, side: 'L' | 'R', id: string): FingerChain | null {
  const bones: THREE.Bone[] = []
  for (const suffix of ['', '1', '2']) {
    const b = bone(root, `Bip01_${side}_Finger${id}${suffix}`)
    if (b) bones.push(b)
  }
  if (!bones.length) return null
  return {
    bones,
    curlAxis: bones.map(() => new THREE.Vector3(0, 0, 1)),
    restQ: bones.map((b) => b.quaternion.clone()),
    spreadAxis: new THREE.Vector3(0, 1, 0),
    longAxis: localAxisToChild(bones[0]),
  }
}

/** Direction from a bone to its first child, in the bone's own local space. */
function localAxisToChild(b: THREE.Bone): THREE.Vector3 {
  const child = b.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined
  if (!child) return new THREE.Vector3(0, 1, 0)
  return child.position.clone().normalize()
}

const _bx = new THREE.Vector3()
const _by = new THREE.Vector3()
const _bz = new THREE.Vector3()
const _bm = new THREE.Matrix4()

/**
 * Build an orthonormal hand basis from a pointing direction and a palm normal.
 * Rest and desired orientations must be built the same way for the delta
 * between them to be meaningful.
 */
function basisQuaternion(along: THREE.Vector3, palmNormal: THREE.Vector3, out: THREE.Quaternion) {
  _by.copy(along).normalize()
  _bz.copy(palmNormal).normalize()
  _bz.addScaledVector(_by, -_bz.dot(_by))
  if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, 1)
  _bz.normalize()
  _bx.crossVectors(_by, _bz)
  _bm.makeBasis(_bx, _by, _bz)
  return out.setFromRotationMatrix(_bm)
}

function buildArm(root: THREE.Object3D, side: 'L' | 'R'): ArmChain {
  const upper = bone(root, `Bip01_${side}_UpperArm`)!
  const fore = bone(root, `Bip01_${side}_Forearm`)!
  const hand = bone(root, `Bip01_${side}_Hand`)!
  const fingers = FINGER_IDS.map((id) => buildFinger(root, side, id)).filter(Boolean) as FingerChain[]
  const thumb = buildFinger(root, side, '0')!

  root.updateMatrixWorld(true)
  const wUpper = upper.getWorldPosition(new THREE.Vector3())
  const wFore = fore.getWorldPosition(new THREE.Vector3())
  const wHand = hand.getWorldPosition(new THREE.Vector3())

  // Hand frame at rest: `across` runs index -> pinky, `along` wrist -> knuckles.
  const idxBase = fingers[0].bones[0].getWorldPosition(new THREE.Vector3())
  const pinkyBase = fingers[3]
    ? fingers[3].bones[0].getWorldPosition(new THREE.Vector3())
    : idxBase.clone().add(new THREE.Vector3(1, 0, 0))
  const across = pinkyBase.clone().sub(idxBase).normalize()
  const knuckleMid = idxBase.clone().add(pinkyBase).multiplyScalar(0.5)
  const along = knuckleMid.clone().sub(wHand).normalize()
  // `across` runs index -> pinky, which reverses between the two hands, so this
  // cross product points out of the PALM on one hand and out of the BACK of the
  // other. Flip the left so "palm normal" means the same thing on both sides -
  // without this the non-dominant hand twists into a claw at rest.
  const palmNormal = new THREE.Vector3().crossVectors(along, across).normalize()
  if (side === 'L') palmNormal.negate()

  // Fingers flex about the `across` axis; express it in each bone's local frame.
  const tmpQ = new THREE.Quaternion()
  const setAxes = (chain: FingerChain) => {
    chain.bones.forEach((b, i) => {
      b.getWorldQuaternion(tmpQ).invert()
      chain.curlAxis[i] = across.clone().applyQuaternion(tmpQ).normalize()
    })
    chain.bones[0].getWorldQuaternion(tmpQ).invert()
    chain.spreadAxis = palmNormal.clone().applyQuaternion(tmpQ).normalize()
  }
  fingers.forEach(setAxes)
  setAxes(thumb)

  const handRestWorldQ = hand.getWorldQuaternion(new THREE.Quaternion())
  const restBasisQ = new THREE.Quaternion()
  basisQuaternion(along, palmNormal, restBasisQ)

  return {
    upper, fore, hand, fingers, thumb,
    handRestWorldQ, restBasisQ,
    upperLen: wUpper.distanceTo(wFore),
    foreLen: wFore.distanceTo(wHand),
    restQ: { upper: upper.quaternion.clone(), fore: fore.quaternion.clone(), hand: hand.quaternion.clone() },
    foreAim: fore.quaternion.clone(),
    smooth: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), started: false },
    axis: { upper: localAxisToChild(upper), fore: localAxisToChild(fore) },
    palmNormal, across, along,
  }
}

/**
 * Collect the head, spine and face bones and record their rest rotations.
 *
 * Axes are derived from the mesh rather than assumed: `right` runs between the
 * eye bones, which gives the axis eyelids close about and eyes pitch about.
 */
function buildFace(root: THREE.Object3D): FaceRig {
  const rest = new Map<THREE.Bone, THREE.Quaternion>()
  const take = (name: string): THREE.Bone | undefined => {
    const b = bone(root, name)
    if (b) rest.set(b, b.quaternion.clone())
    return b
  }
  const neck = take('Bip01_Neck')
  const head = take('Bip01_Head')
  const spine = ['Bip01_Spine1', 'Bip01_Spine2'].map(take).filter(Boolean) as THREE.Bone[]
  const eyes = ['Bip01_LEye', 'Bip01_REye'].map(take).filter(Boolean) as THREE.Bone[]
  // The eyelid bones (Bip01_L/REyeBlinkTop/Bottom) are deliberately not used:
  // they only half-close the eye and cancel out the ARKit blink shapes.

  root.updateMatrixWorld(true)
  const right = new THREE.Vector3(1, 0, 0)
  if (eyes.length === 2) {
    const a = eyes[0].getWorldPosition(new THREE.Vector3())
    const b = eyes[1].getWorldPosition(new THREE.Vector3())
    right.subVectors(b, a).normalize()
  }
  const up = new THREE.Vector3(0, 1, 0)
  // cross(up, right), not cross(right, up): with `right` running L-eye to
  // R-eye (the character's right, -x) the other order points out the BACK of
  // the head, which silently inverted head roll and gaze.
  const forward = new THREE.Vector3().crossVectors(up, right).normalize()

  return { neck, head, spine, eyes, rest, right, up, forward }
}

export async function loadSigner(): Promise<SignerRig> {
  const loader = new FBXLoader()
  const fbx = await loader.loadAsync(MODEL_URL)

  const texLoader = new THREE.TextureLoader()
  const load = (url: string, srgb: boolean) => {
    const t = texLoader.load(url)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 4
    return t
  }

  let mesh: THREE.SkinnedMesh | undefined
  fbx.traverse((o) => {
    const sm = o as THREE.SkinnedMesh
    if (!sm.isSkinnedMesh) return
    mesh = sm
    sm.castShadow = true
    sm.receiveShadow = true
    sm.frustumCulled = false
    const mats = Array.isArray(sm.material) ? sm.material : [sm.material]
    sm.material = mats.map((m) => {
      const spec = TEXTURES[m.name]
      const mat = new THREE.MeshStandardMaterial({
        name: m.name,
        map: spec ? load(spec.color, true) : null,
        normalMap: spec?.normal ? load(spec.normal, false) : null,
        // Inverted specular from Rocketbox. Without it skin is a flat matte
        // plane, which is what made the forehead look waxy.
        roughnessMap: spec?.rough ? load(spec.rough, false) : null,
        roughness: m.name === 'f014_head' ? 0.86 : 0.95,
        metalness: 0,
      })
      if (m.name === 'f014_opacity') {
        mat.transparent = true
        mat.alphaTest = 0.45
        mat.side = THREE.DoubleSide
      }
      return mat
    })
  })
  if (!mesh) throw new Error('signer: no SkinnedMesh in FBX')
  pruneMorphs(mesh)

  // Normalise: Rocketbox is modelled in centimetres, feet at y=0.
  const box = new THREE.Box3().setFromObject(fbx)
  const scale = SIGNER_HEIGHT / (box.max.y - box.min.y)
  fbx.scale.setScalar(scale)
  fbx.position.y = -SIGNER_HEIGHT / 2
  fbx.updateMatrixWorld(true)

  const left = buildArm(fbx, 'L')
  const right = buildArm(fbx, 'R')

  const morphTargets: Record<string, number> = { ...(mesh.morphTargetDictionary ?? {}) }

  const rootInv = new THREE.Matrix4().copy(fbx.matrixWorld).invert()
  const shoulderPos = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv)

  return {
    root: fbx,
    mesh,
    left,
    right,
    face: buildFace(fbx),
    morphTargets,
    morphInfluences: mesh.morphTargetInfluences ?? [],
    shoulder: { left: shoulderPos(left.upper), right: shoulderPos(right.upper) },
  }
}

// ---------------------------------------------------------------------------
// Posing. Everything below applies rotations RELATIVE TO THE REST POSE, because
// Biped bone axes follow no convention we can assume.
// ---------------------------------------------------------------------------

const _pq = new THREE.Quaternion()
const _rw = new THREE.Quaternion()
const _cur = new THREE.Vector3()
const _dq = new THREE.Quaternion()
const _want = new THREE.Quaternion()
const _tmp = new THREE.Vector3()
const _sh = new THREE.Vector3()
const _el = new THREE.Vector3()
const _wr = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _bend = new THREE.Vector3()

const damp = (t: number, lambda: number) => 1 - Math.exp(-lambda * t)

/**
 * Per-channel response rates. The arm is the heaviest thing on the body and the
 * fingers the lightest, so they should not settle at the same speed: in real
 * signing the handshape forms *during* transport rather than snapping into place
 * on arrival. That difference is most of what reads as fluency.
 */
const ARM_LAMBDA = 9
const WRIST_LAMBDA = 12
const FINGER_LAMBDA = 19

/**
 * Local quaternion that points `b`'s local `axis` along world direction `dir`.
 * Written into `out` rather than applied, so a caller can fold in extra
 * rotation before committing - the forearm needs its aim and its pronation
 * applied as one target, not as two writes that fight each other.
 */
function aimQuaternion(b: THREE.Bone, axis: THREE.Vector3, restQ: THREE.Quaternion, dir: THREE.Vector3, out: THREE.Quaternion) {
  b.parent?.getWorldQuaternion(_pq)
  _rw.copy(_pq).multiply(restQ)
  _cur.copy(axis).applyQuaternion(_rw).normalize()
  _dq.setFromUnitVectors(_cur, dir)
  out.copy(_dq).multiply(_rw)
  _pq.invert()
  out.premultiply(_pq)
}

/** Rotate `b` so that its local `axis` points along world direction `dir`. */
function aimBone(b: THREE.Bone, axis: THREE.Vector3, restQ: THREE.Quaternion, dir: THREE.Vector3, dt: number, lambda = 13) {
  aimQuaternion(b, axis, restQ, dir, _want)
  b.quaternion.slerp(_want, damp(dt, lambda))
  b.updateMatrixWorld(true)
}

const _springOffset = new THREE.Vector3()
const _springStep = new THREE.Vector3()

/**
 * Follow `raw` with a critically-damped spring.
 *
 * Damping the joint rotations smooths position but leaves acceleration free, so
 * a target that jumps still produces a visible snap. Running the target itself
 * through a second-order follower bounds acceleration, which is what makes the
 * arm read as carrying weight rather than being teleported.
 */
export function smoothTarget(arm: ArmChain, raw: THREE.Vector3, dt: number, omega = 19) {
  const s = arm.smooth
  if (!s.started) {
    s.pos.copy(raw)
    s.vel.set(0, 0, 0)
    s.started = true
    return s.pos
  }
  // Closed-form critically damped step for a target held over this frame.
  // Unlike explicit Euler this stays stable after a dropped/slow frame.
  const decay = Math.exp(-omega * dt)
  _springOffset.subVectors(s.pos, raw)
  _springStep.copy(s.vel).addScaledVector(_springOffset, omega)
  s.vel.addScaledVector(_springStep, -omega * dt).multiplyScalar(decay)
  _springOffset.addScaledVector(_springStep, dt).multiplyScalar(decay)
  s.pos.copy(raw).add(_springOffset)
  return s.pos
}

/**
 * Two-bone IK in world space. Solves elbow and wrist positions analytically,
 * then aims each bone at the next, which keeps it rig-agnostic.
 */
export function solveArmIK(arm: ArmChain, targetWorld: THREE.Vector3, side: number, dt: number) {
  arm.upper.getWorldPosition(_sh)
  const l1 = arm.upperLen
  const l2 = arm.foreLen
  _dir.subVectors(targetWorld, _sh)
  const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.01)
  _dir.normalize()

  const cosS = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
  const offset = Math.acos(THREE.MathUtils.clamp(cosS, -1, 1))

  // Elbow pole: down, outward, slightly back, so arms clear the torso.
  _pole.set(side * 0.32, -1, -0.20).normalize()
  _bend.crossVectors(_dir, _pole)
  if (_bend.lengthSq() < 1e-6) _bend.set(side, 0, 0)
  _bend.normalize()

  _tmp.copy(_dir).applyAxisAngle(_bend, offset)     // upper-arm direction
  _el.copy(_sh).addScaledVector(_tmp, l1)           // elbow position
  _wr.copy(_sh).addScaledVector(_dir, d)            // wrist position

  aimBone(arm.upper, arm.axis.upper, arm.restQ.upper, _tmp, dt, ARM_LAMBDA)
  // The forearm's aim is recorded, not applied: setHandOrientation folds the
  // pronation into it and commits both together.
  _tmp.subVectors(_wr, _el).normalize()
  aimQuaternion(arm.fore, arm.axis.fore, arm.restQ.fore, _tmp, arm.foreAim)
}

/**
 * Orient the hand so the palm faces `palm` and the fingers point along `point`.
 *
 * Palm orientation is one of the five ASL parameters, so it must be set
 * explicitly rather than inherited from whatever roll the IK produced. The
 * rotation is computed as the delta between the rest hand basis and the
 * desired one, then applied to the hand's rest world rotation.
 */
const _twist = new THREE.Quaternion()
const _swing = new THREE.Quaternion()
const _inv = new THREE.Quaternion()
const _swingAxis = new THREE.Vector3()
const _foreAimWorld = new THREE.Quaternion()
const _foreTarget = new THREE.Quaternion()
const _rel = new THREE.Quaternion()
const _canon = new THREE.Quaternion()

/**
 * The wrist can bend and deviate but cannot twist: rotation about the forearm's
 * long axis is pronation/supination, which happens along the FOREARM as the
 * radius crosses the ulna. Roughly 70 degrees of bend is the human limit.
 */
const MAX_WRIST_SWING = 1.15

/**
 * Split `q` into a twist about `axis` and the swing that remains.
 *
 * Both outputs are canonicalised to the w >= 0 hemisphere. q and -q are the
 * same rotation, but the axis extracted from them points opposite ways, so
 * without this the decomposition flips sign as w crosses zero and the joint
 * snaps mid-motion.
 */
function canonicalise(q: THREE.Quaternion) {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
}

function swingTwist(q: THREE.Quaternion, axis: THREE.Vector3) {
  _canon.copy(q)
  canonicalise(_canon)
  const d = _canon.x * axis.x + _canon.y * axis.y + _canon.z * axis.z
  _twist.set(axis.x * d, axis.y * d, axis.z * d, _canon.w)
  if (_twist.lengthSq() < 1e-8) _twist.set(0, 0, 0, 1)
  else _twist.normalize()
  canonicalise(_twist)
  _inv.copy(_twist).invert()
  _swing.copy(_canon).multiply(_inv)
  canonicalise(_swing)
}

/**
 * Orient the hand so the palm faces `palm` and the fingers point along `point`.
 *
 * Palm orientation carries meaning in ASL, so it must be set explicitly rather
 * than inherited from whatever roll the IK produced. But applying the whole
 * rotation to the wrist bends it backwards through the forearm and drives the
 * hand into the body. Instead the required rotation is split: the twist goes to
 * the forearm as pronation, and only the clamped swing reaches the wrist.
 */
export function setHandOrientation(arm: ArmChain, palm: THREE.Vector3, point: THREE.Vector3, dt: number) {
  // Desired hand orientation, in world space.
  basisQuaternion(point, palm, _want)
  _rw.copy(arm.restBasisQ).invert()
  _want.multiply(_rw)                          // delta = desired * rest^-1
  _want.multiply(arm.handRestWorldQ)

  // Where the forearm will be once its IK aim is committed. Measuring against
  // the aim rather than the forearm's current rotation keeps this stable; using
  // the current value makes the roll chase itself frame to frame.
  arm.fore.parent?.getWorldQuaternion(_pq)
  _foreAimWorld.copy(_pq).multiply(arm.foreAim)

  // Rotation still needed, expressed in the forearm's frame.
  _rel.copy(_foreAimWorld).invert().multiply(_want)
  swingTwist(_rel, arm.axis.fore)

  // Pronation belongs to the forearm: the radius rotating over the ulna is what
  // turns your palm over, not the wrist. Fold it into the aim and commit once.
  _foreTarget.copy(arm.foreAim).multiply(_twist)
  arm.fore.quaternion.slerp(_foreTarget, damp(dt, ARM_LAMBDA))
  arm.fore.updateMatrixWorld(true)

  // Whatever remains is wrist bend, clamped to a human range. Without this the
  // wrist folds backwards through the forearm and the hand enters the body.
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(_swing.w, -1, 1))
  if (angle > MAX_WRIST_SWING) {
    _swingAxis.set(_swing.x, _swing.y, _swing.z)
    if (_swingAxis.lengthSq() > 1e-8) {
      _swingAxis.normalize()
      _swing.setFromAxisAngle(_swingAxis, MAX_WRIST_SWING)
    }
  }
  arm.hand.quaternion.slerp(_swing, damp(dt, WRIST_LAMBDA))
  arm.hand.updateMatrixWorld(true)
}

export type FingerTarget = { curl: readonly [number, number, number]; spread: number }

/** Sign of the flexion rotation; calibrated once, see calibrateCurl. */
let CURL_SIGN = 1
export function setCurlSign(s: number) { CURL_SIGN = s }

function applyFinger(chain: FingerChain, t: FingerTarget, dt: number, lambda = FINGER_LAMBDA) {
  for (let i = 0; i < chain.bones.length; i++) {
    const b = chain.bones[i]
    const angle = (t.curl[i] ?? t.curl[t.curl.length - 1] * 0.7) * CURL_SIGN
    _dq.setFromAxisAngle(chain.curlAxis[i], angle)
    _want.copy(chain.restQ[i]).multiply(_dq)
    if (i === 0 && t.spread) {
      _dq.setFromAxisAngle(chain.spreadAxis, t.spread * CURL_SIGN)
      _want.multiply(_dq)
    }
    b.quaternion.slerp(_want, damp(dt, lambda))
  }
}

export type ThumbTarget = {
  abduct: number
  rotate: number
  curl: readonly [number, number]
}

/**
 * The thumb carries three degrees of freedom the other fingers do not:
 * abduction away from the palm, opposition (rotation about its own axis) and
 * flexion. Handshapes like `a`, `s`, `baby_o` and `open_8` are distinguished
 * almost entirely by these, so they cannot be collapsed into a curl value.
 */
function applyThumb(chain: FingerChain, t: ThumbTarget, dt: number, lambda = FINGER_LAMBDA) {
  const base = chain.bones[0]
  _want.copy(chain.restQ[0])
  _dq.setFromAxisAngle(chain.spreadAxis, t.abduct * CURL_SIGN)
  _want.multiply(_dq)
  _dq.setFromAxisAngle(chain.longAxis, t.rotate * CURL_SIGN)
  _want.multiply(_dq)
  _dq.setFromAxisAngle(chain.curlAxis[0], t.curl[0] * CURL_SIGN)
  _want.multiply(_dq)
  base.quaternion.slerp(_want, damp(dt, lambda))

  for (let i = 1; i < chain.bones.length; i++) {
    const angle = (i === 1 ? t.curl[1] : t.curl[1] * 0.7) * CURL_SIGN
    _dq.setFromAxisAngle(chain.curlAxis[i], angle)
    _want.copy(chain.restQ[i]).multiply(_dq)
    chain.bones[i].quaternion.slerp(_want, damp(dt, lambda))
  }
}

export function applyHand(arm: ArmChain, fingers: readonly FingerTarget[], thumb: ThumbTarget, dt: number) {
  for (let i = 0; i < arm.fingers.length; i++) {
    const t = fingers[i]
    if (t) applyFinger(arm.fingers[i], t, dt)
  }
  applyThumb(arm.thumb, thumb, dt)
}

/**
 * Set a morph influence immediately, with no damping. A blink is only ~130ms
 * long, so damping toward it never lets the eye fully close - the sine pulse
 * driving it is already smooth.
 */
export function setMorphDirect(rig: SignerRig, name: string, value: number) {
  const idx = rig.morphTargets[name]
  if (idx === undefined) return
  const infl = rig.mesh.morphTargetInfluences
  if (infl) infl[idx] = value
}

/** Set a morph target by its short name (the blendShape1. prefix is stripped). */
export function setMorph(rig: SignerRig, name: string, value: number, dt: number, lambda = 10) {
  const idx = rig.morphTargets[name]
  if (idx === undefined) return
  const infl = rig.mesh.morphTargetInfluences
  if (!infl) return
  infl[idx] = THREE.MathUtils.damp(infl[idx] ?? 0, value, lambda, dt)
}


// ---------------------------------------------------------------------------
// Head, spine and face motion.
//
// Everything rotates about WORLD axes relative to the bone's rest pose, so no
// assumption is made about Biped's local bone conventions.
// ---------------------------------------------------------------------------

const _delta2 = new THREE.Quaternion()
const _restW = new THREE.Quaternion()

export type AxisTurn = { axis: THREE.Vector3; angle: number }

/** Rotate `b` by the given world-axis turns, relative to its rest pose. */
export function rotateWorld(
  b: THREE.Bone | undefined,
  rest: Map<THREE.Bone, THREE.Quaternion>,
  turns: readonly AxisTurn[],
  dt: number,
  lambda = 9,
) {
  if (!b) return
  const restQ = rest.get(b)
  if (!restQ) return
  b.parent?.getWorldQuaternion(_pq)
  _restW.copy(_pq).multiply(restQ)
  _want.identity()
  for (const turn of turns) {
    if (!turn.angle) continue
    _delta2.setFromAxisAngle(turn.axis, turn.angle)
    _want.premultiply(_delta2)
  }
  _want.multiply(_restW)
  _pq.invert()
  _want.premultiply(_pq)
  b.quaternion.slerp(_want, damp(dt, lambda))
  b.updateMatrixWorld(true)
}

/** Lean and breathe, spread across the spine so it does not hinge at one joint. */
export function applySpine(face: FaceRig, lean: number, breathe: number, dt: number) {
  const n = face.spine.length || 1
  for (let i = 0; i < face.spine.length; i++) {
    const w = (i + 1) / n
    rotateWorld(face.spine[i], face.rest, [
      { axis: face.forward, angle: (lean / n) * w },
      { axis: face.right, angle: (breathe / n) * w },
    ], dt, 6)
  }
}

/** Head turn, split with the neck so the whole column moves. */
export function applyHead(face: FaceRig, pitch: number, yaw: number, roll: number, dt: number) {
  const turns = (k: number): AxisTurn[] => [
    { axis: face.right, angle: pitch * k },
    { axis: face.up, angle: yaw * k },
    { axis: face.forward, angle: roll * k },
  ]
  rotateWorld(face.neck, face.rest, turns(0.55), dt, 7)
  rotateWorld(face.head, face.rest, turns(0.45), dt, 8)
}

const _eyePos = new THREE.Vector3()
const _eyeDir = new THREE.Vector3()

/**
 * Aim both eyes at the same world point.
 *
 * Rotating each eye by the SAME angles does not converge them - the eyes sit
 * either side of the nose, so equal rotations leave them walleyed, staring
 * past the viewer. That divergence is what reads as dead-eyed and is the main
 * thing that makes a face unsettling.
 */
export function applyGazeTarget(face: FaceRig, target: THREE.Vector3, dt: number) {
  for (const eye of face.eyes) {
    const restQ = face.rest.get(eye)
    if (!restQ) continue
    eye.getWorldPosition(_eyePos)
    _eyeDir.subVectors(target, _eyePos).normalize()
    eye.parent?.getWorldQuaternion(_pq)
    _restW.copy(_pq).multiply(restQ)
    _delta2.setFromUnitVectors(face.forward, _eyeDir)
    _want.copy(_delta2).multiply(_restW)
    _pq.invert()
    _want.premultiply(_pq)
    eye.quaternion.slerp(_want, damp(dt, 16))
    eye.updateMatrixWorld(true)
  }
}

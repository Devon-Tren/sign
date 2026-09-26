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
  /** Direction that bends this mirrored chain toward its own palm. */
  curlSign: 1 | -1
  /** Direction that abducts this chain toward the little-finger side. */
  spreadSign: 1 | -1
  restQ: THREE.Quaternion[]
  /** Abduction axis (spread) for the first joint only. */
  spreadAxis: THREE.Vector3
  /** The first bone's own long axis, used for thumb opposition. */
  longAxis: THREE.Vector3
}

export type ArmChain = {
  clavicle?: THREE.Bone
  upper: THREE.Bone
  fore: THREE.Bone
  hand: THREE.Bone
  /** index, middle, ring, pinky */
  fingers: FingerChain[]
  thumb: FingerChain
  upperLen: number
  foreLen: number
  restQ: { clavicle?: THREE.Quaternion; upper: THREE.Quaternion; fore: THREE.Quaternion; hand: THREE.Quaternion }
  /** Direction each bone points in its own local frame, at rest. */
  axis: { clavicle?: THREE.Vector3; upper: THREE.Vector3; fore: THREE.Vector3 }
  /** Maps the bone's calibrated forearm frame to a thumb-up anatomical frame. */
  foreBasisInv: THREE.Quaternion
  side: number
  ikUpper: THREE.Vector3
  ikFore: THREE.Vector3
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
    curlSign: 1,
    spreadSign: 1,
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
  if (_by.lengthSq() < 1e-8) _by.set(0, 1, 0)
  _bz.copy(palmNormal).normalize()
  _bz.addScaledVector(_by, -_bz.dot(_by))
  if (_bz.lengthSq() < 1e-8) {
    _bz.set(0, Math.abs(_by.y) < 0.9 ? 1 : 0, Math.abs(_by.y) < 0.9 ? 0 : 1)
    _bz.addScaledVector(_by, -_bz.dot(_by))
  }
  _bz.normalize()
  _bx.crossVectors(_by, _bz)
  _bm.makeBasis(_bx, _by, _bz)
  return out.setFromRotationMatrix(_bm)
}

/**
 * Which rotation direction actually FLEXES a finger chain.
 *
 * The 3ds Max Biped hands are mirrored, so a single global curl direction bends
 * one hand's fingers backwards. The previous calibration derived the answer
 * from a dot product against the palm normal, which depends on getting three
 * sign conventions right at once - which way `across` runs, which way the cross
 * product points, and which side the palm normal faces after the left-hand
 * flip. Get any one backwards and every finger hyperextends into a claw.
 *
 * So do not derive it. MEASURE it, using a fact with no sign convention in it:
 * flexion is the motion that brings the fingertip CLOSER TO THE WRIST. That is
 * true of every finger, on either hand, whatever the local bone axes are.
 * Rotate the chain both ways, keep whichever shortens that distance, and put
 * the skeleton back.
 */
function calibrateCurlSign(chain: FingerChain, wrist: THREE.Bone): 1 | -1 {
  const tip = chain.bones[chain.bones.length - 1]
  const wristPos = wrist.getWorldPosition(new THREE.Vector3())
  const saved = chain.bones.map((b) => b.quaternion.clone())
  const probe = new THREE.Quaternion()
  const tipPos = new THREE.Vector3()

  const reach = (sign: 1 | -1) => {
    chain.bones.forEach((b, i) => {
      probe.setFromAxisAngle(chain.curlAxis[i], 0.6 * sign)
      b.quaternion.copy(chain.restQ[i]).multiply(probe)
    })
    wrist.updateMatrixWorld(true)
    return tip.getWorldPosition(tipPos).distanceTo(wristPos)
  }

  const positive = reach(1)
  const negative = reach(-1)
  chain.bones.forEach((b, i) => b.quaternion.copy(saved[i]))
  wrist.updateMatrixWorld(true)
  return positive <= negative ? 1 : -1
}

/** Calibrate an outward spread against the middle of the finger group. */
function calibrateSpreadSign(chain: FingerChain, wrist: THREE.Bone,
  reference: THREE.Vector3, outwardRequest: 1 | -1): 1 | -1 {
  const tip = chain.bones[chain.bones.length - 1]
  const saved = chain.bones[0].quaternion.clone()
  const probe = new THREE.Quaternion()
  const tipPos = new THREE.Vector3()

  const gap = (sign: 1 | -1) => {
    probe.setFromAxisAngle(chain.spreadAxis, 0.3 * outwardRequest * sign)
    chain.bones[0].quaternion.copy(chain.restQ[0]).multiply(probe)
    wrist.updateMatrixWorld(true)
    return tip.getWorldPosition(tipPos).distanceTo(reference)
  }

  const positive = gap(1)
  const negative = gap(-1)
  chain.bones[0].quaternion.copy(saved)
  wrist.updateMatrixWorld(true)
  return positive >= negative ? 1 : -1
}

function buildArm(root: THREE.Object3D, side: 'L' | 'R'): ArmChain {
  const clavicle = bone(root, `Bip01_${side}_Clavicle`)
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
  // A thumb does not hinge across the palm like the four fingers. Each of its
  // phalanges has a different direction, so derive a clean hinge for every
  // bone from cross(bone direction, palm normal), expressed in that bone's
  // local frame. Reusing `across` leaves this rig's thumb axes 59-71° off the
  // hinge and turns requested flexion into axial twisting.
  thumb.bones.forEach((b, i) => {
    const child = b.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined
    const from = b.getWorldPosition(new THREE.Vector3())
    const to = child
      ? child.getWorldPosition(new THREE.Vector3())
      : from.clone().sub((b.parent as THREE.Object3D).getWorldPosition(new THREE.Vector3())).add(from)
    const boneDirection = to.sub(from).normalize()
    b.getWorldQuaternion(tmpQ).invert()
    const localDirection = boneDirection.applyQuaternion(tmpQ).normalize()
    const localPalm = palmNormal.clone().applyQuaternion(tmpQ).normalize()
    thumb.curlAxis[i].crossVectors(localDirection, localPalm).normalize()
  })

  // Calibrate each finger relative to the middle of the group. The signed
  // requests emitted by spreadOf are negative on the index side and positive
  // on the pinky side, so both halves move outward without using the thumb as
  // a misleading fixed reference.
  const middleTip = fingers[1].bones.at(-1)!.getWorldPosition(new THREE.Vector3())
  const ringTip = fingers[2].bones.at(-1)!.getWorldPosition(new THREE.Vector3())
  const indexBase = fingers[0].bones[0].getWorldPosition(new THREE.Vector3())
  for (let i = 0; i < fingers.length; i++) {
    const chain = fingers[i]
    chain.curlSign = calibrateCurlSign(chain, hand)
    const reference = i === 1 ? ringTip : middleTip
    chain.spreadSign = calibrateSpreadSign(chain, hand, reference, i < 2 ? -1 : 1)
  }
  thumb.curlSign = calibrateCurlSign(thumb, hand)
  thumb.spreadSign = calibrateSpreadSign(thumb, hand, indexBase, 1)

  const handRestWorldQ = hand.getWorldQuaternion(new THREE.Quaternion())
  const restBasisQ = new THREE.Quaternion()
  basisQuaternion(along, palmNormal, restBasisQ)
  const foreRestWorld = fore.getWorldQuaternion(new THREE.Quaternion())
  const foreBasisInv = basisQuaternion(localAxisToChild(fore),
    palmNormal.clone().applyQuaternion(foreRestWorld.invert()), new THREE.Quaternion()).invert()

  return {
    clavicle, upper, fore, hand, fingers, thumb,
    handRestWorldQ, restBasisQ,
    upperLen: wUpper.distanceTo(wFore),
    foreLen: wFore.distanceTo(wHand),
    restQ: {
      clavicle: clavicle?.quaternion.clone(),
      upper: upper.quaternion.clone(), fore: fore.quaternion.clone(), hand: hand.quaternion.clone(),
    },
    foreBasisInv, side: side === 'R' ? -1 : 1,
    ikUpper: new THREE.Vector3(), ikFore: new THREE.Vector3(),
    smooth: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), started: false },
    axis: {
      clavicle: clavicle ? localAxisToChild(clavicle) : undefined,
      upper: localAxisToChild(upper), fore: localAxisToChild(fore),
    },
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
const _claviclePos = new THREE.Vector3()
const _clavicleRest = new THREE.Vector3()
const _clavicleTarget = new THREE.Vector3()
const _swivelFrom = new THREE.Vector3(), _swivelTo = new THREE.Vector3()
const _swivelCross = new THREE.Vector3(), _aimCorrection = new THREE.Quaternion()
const previousUpper = new WeakMap<ArmChain, THREE.Vector3>()

const damp = (t: number, lambda: number) => 1 - Math.exp(-lambda * t)

/**
 * Per-channel response rates. The arm is the heaviest thing on the body and the
 * fingers the lightest, so they should not settle at the same speed: in real
 * signing the handshape forms *during* transport rather than snapping into place
 * on arrival. That difference is most of what reads as fluency.
 */
const ARM_LAMBDA = 7.5
const WRIST_LAMBDA = 9
const FINGER_LAMBDA = 12
const ARM_MAX_RAD_S = 7
const WRIST_MAX_RAD_S = 9
const FINGER_MAX_RAD_S = 14

/**
 * Exact tracking. The planned motion (./sequence schedules velocity-bounded
 * transitions; ./clips eases every stroke) is already smooth, so exponential
 * damping on top only delayed it: measured 100-117 ms behind the path on every
 * sign, corners cut and contacts missed (THANK YOU never reached the chin).
 * In exact mode joints land on the requested pose each frame; only a generous
 * velocity ceiling remains, as a rate limiter that is transparent to any
 * feasible motion and turns a genuine jump (an interrupted utterance) into a
 * fast move instead of a teleport. Set by ./rigPose per application.
 */
export const tracking = { exact: false }
const EXACT_CAP_SCALE = 2.3
/** Wrist target speed ceiling in exact mode, in arm reaches per second. The
 *  scheduler plans transitions at <= 3.2, so this never touches planned motion. */
const EXACT_TARGET_SPEED = 4.5

/** Exponential response with a hard angular-velocity ceiling. Damping alone is
 * frame-rate independent, but a large target change can still rotate most of
 * a joint in one rendered frame. The cap preserves the response while making
 * dropped frames and abrupt sign changes physically calmer. */
function slerpLimited(
  current: THREE.Quaternion,
  target: THREE.Quaternion,
  dt: number,
  lambda: number,
  maxRadiansPerSecond: number,
) {
  const angle = current.angleTo(target)
  if (angle < 1e-6) return
  if (tracking.exact) {
    current.slerp(target, Math.min(1, (maxRadiansPerSecond * EXACT_CAP_SCALE * dt) / angle))
    return
  }
  const response = damp(dt, lambda)
  const velocityLimit = (maxRadiansPerSecond * dt) / angle
  current.slerp(target, Math.min(response, velocityLimit, 1))
}

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
function aimBone(
  b: THREE.Bone,
  axis: THREE.Vector3,
  restQ: THREE.Quaternion,
  dir: THREE.Vector3,
  dt: number,
  lambda = 13,
  maxRadiansPerSecond = ARM_MAX_RAD_S,
) {
  aimQuaternion(b, axis, restQ, dir, _want)
  slerpLimited(b.quaternion, _want, dt, lambda, maxRadiansPerSecond)
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
export function smoothTarget(arm: ArmChain, raw: THREE.Vector3, dt: number, omega = 13) {
  const s = arm.smooth
  if (!s.started) {
    s.pos.copy(raw)
    s.vel.set(0, 0, 0)
    s.started = true
    return s.pos
  }
  if (tracking.exact) {
    // Rate limit, not a filter: zero lag while the path is feasible.
    const maxStep = EXACT_TARGET_SPEED * (arm.upperLen + arm.foreLen) * dt
    _springOffset.subVectors(raw, s.pos)
    const gap = _springOffset.length()
    s.pos.addScaledVector(_springOffset, gap > maxStep ? maxStep / gap : 1)
    s.vel.set(0, 0, 0)
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
export function solveArmIK(
  arm: ArmChain,
  targetWorld: THREE.Vector3,
  side: number,
  dt: number,
  poleDirection?: THREE.Vector3,
  palm?: THREE.Vector3,
  point?: THREE.Vector3,
  maxWristSwing = MAX_WRIST_SWING,
) {
  // Share high/reaching motion with the shoulder girdle. A two-bone arm alone
  // leaves the clavicle frozen and produces the mannequin-like 90-degree pose
  // most visible in head-level signs. Only a conservative fraction follows so
  // the chest does not collapse toward the hand.
  if (arm.clavicle && arm.axis.clavicle && arm.restQ.clavicle) {
    arm.clavicle.getWorldPosition(_claviclePos)
    arm.clavicle.parent?.getWorldQuaternion(_pq)
    _rw.copy(_pq).multiply(arm.restQ.clavicle)
    _clavicleRest.copy(arm.axis.clavicle).applyQuaternion(_rw).normalize()
    _clavicleTarget.subVectors(targetWorld, _claviclePos).normalize()
    const lift = THREE.MathUtils.clamp((_clavicleTarget.y + 0.05) * 0.20, 0, 0.18)
    const lateral = THREE.MathUtils.clamp(Math.abs(_clavicleTarget.x) * 0.08, 0, 0.06)
    _clavicleTarget.lerp(_clavicleRest, 1 - lift - lateral).normalize()
    aimBone(arm.clavicle, arm.axis.clavicle, arm.restQ.clavicle,
      _clavicleTarget, dt, ARM_LAMBDA * 0.72, ARM_MAX_RAD_S * 0.45)
  }

  arm.upper.getWorldPosition(_sh)
  const l1 = arm.upperLen
  const l2 = arm.foreLen
  _dir.subVectors(targetWorld, _sh)
  const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.01)
  _dir.normalize()

  const cosS = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
  const offset = Math.acos(THREE.MathUtils.clamp(cosS, -1, 1))

  // Elbow pole: down, outward, slightly back, so arms clear the torso.
  if (poleDirection) _pole.copy(poleDirection).normalize()
  else _pole.set(side * 0.32, -1, -0.20).normalize()
  _bend.crossVectors(_dir, _pole)
  if (_bend.lengthSq() < 1e-6) _bend.set(side, 0, 0)
  _bend.normalize()

  _tmp.copy(_dir).applyAxisAngle(_bend, offset)     // upper-arm direction
  _el.copy(_sh).addScaledVector(_tmp, l1)           // elbow position
  _wr.copy(_sh).addScaledVector(_dir, d)            // wrist position

  if (palm && point) {
    desiredHand(arm, palm, point, _orientationWant)
    chooseElbow(arm, _sh, _wr, _dir, _tmp, _orientationWant, maxWristSwing)
  }
  // Smooth the swivel ON the elbow circle. Slerping upper/forearm rotations
  // independently takes the wrist off its target, especially after a large
  // shoulder adjustment. Target translation is already smoothed separately.
  const previous = previousUpper.get(arm)
  if (previous) {
    _swivelFrom.copy(previous).addScaledVector(_dir, -previous.dot(_dir))
    _swivelTo.copy(_tmp).addScaledVector(_dir, -_tmp.dot(_dir)).normalize()
    if (_swivelFrom.lengthSq() > 1e-8) {
      _swivelFrom.normalize()
      const angle = Math.atan2(_swivelCross.crossVectors(_swivelFrom, _swivelTo).dot(_dir),
        _swivelFrom.dot(_swivelTo))
      const cap = ARM_MAX_RAD_S * (tracking.exact ? EXACT_CAP_SCALE : 1) * dt
      const step = THREE.MathUtils.clamp(angle * (tracking.exact ? 1 : damp(dt, ARM_LAMBDA)), -cap, cap)
      _swivelFrom.applyAxisAngle(_dir, step)
      _tmp.copy(_dir).multiplyScalar(Math.cos(offset)).addScaledVector(_swivelFrom, Math.sin(offset))
    }
    previous.copy(_tmp)
  } else previousUpper.set(arm, _tmp.clone())
  _el.copy(_sh).addScaledVector(_tmp, l1)
  arm.ikUpper.copy(_tmp)
  arm.ikFore.subVectors(_wr, _el).normalize()

  aimQuaternion(arm.upper, arm.axis.upper, arm.restQ.upper, _tmp, _want)
  arm.upper.quaternion.copy(_want)
  arm.upper.updateMatrixWorld(true)
  // setHandOrientation constructs the forearm's anatomical frame from these
  // directions, then commits its aim and bounded pronation together.
}

/**
 * Orient the hand so the palm faces `palm` and the fingers point along `point`.
 *
 * Palm orientation is one of the five ASL parameters, so it must be set
 * explicitly rather than inherited from whatever roll the IK produced. The
 * rotation is computed as the delta between the rest hand basis and the
 * desired one, then applied to the hand's rest world rotation.
 */
const MAX_WRIST_SWING = 0.96
const PRONATION = 85 * Math.PI / 180
const SUPINATION = Math.PI / 2
const _orientationWant = new THREE.Quaternion()
const _neutral = new THREE.Quaternion(), _relative = new THREE.Quaternion()
const _foreWorld = new THREE.Quaternion(), _handLocal = new THREE.Quaternion()
const _foreLocal = new THREE.Quaternion(), _identity = new THREE.Quaternion()
const _neutralPalm = new THREE.Vector3(), _candidateUpper = new THREE.Vector3()
const _candidateFore = new THREE.Vector3(), _candidateElbow = new THREE.Vector3()
const _bestUpper = new THREE.Vector3(), _preferredUpper = new THREE.Vector3()
const _clearancePoint = new THREE.Vector3()
const _orientationDelta = new THREE.Quaternion(), _solvedPalm = new THREE.Vector3()
const _solvedPoint = new THREE.Vector3(), _desiredPalm = new THREE.Vector3()
const _desiredPoint = new THREE.Vector3()

function desiredHand(arm: ArmChain, palm: THREE.Vector3, point: THREE.Vector3, out: THREE.Quaternion) {
  return basisQuaternion(point, palm, out)
    .multiply(_rw.copy(arm.restBasisQ).invert()).multiply(arm.handRestWorldQ)
}

/**
 * Zero pronation is thumb-up with respect to the elbow's flexion plane.
 * Its palm normal is perpendicular to that plane (mirrored for the left arm),
 * not a shortest-arc rotation from the model's T pose. Thus raising the arm
 * does not move the anatomical pronation window.
 *
 * Work relative to the hand's bind rotation. The maximum-dot projection onto
 * the forearm's twist subgroup assigns as much rotation as possible to the
 * forearm, minimising the residual wrist rotation. Recompute that residual
 * AFTER limiting twist, so neither joint silently discards the other's work.
 * When their combined range is insufficient, chooseElbow searches the remaining
 * shoulder DOF; the wrist target stays on exactly the same two-bone IK sphere.
 */
function orientAt(
  arm: ArmChain, upper: THREE.Vector3, fore: THREE.Vector3,
  desired: THREE.Quaternion, maxWrist: number,
) {
  _neutralPalm.crossVectors(upper, fore).multiplyScalar(arm.side).normalize()
  if (_neutralPalm.lengthSq() < 1e-8) {
    _neutralPalm.set(-arm.side, 0, 0).addScaledVector(fore, arm.side * fore.x).normalize()
  }
  basisQuaternion(fore, _neutralPalm, _neutral).multiply(arm.foreBasisInv)
  _relative.copy(_neutral).invert().multiply(desired)
    .multiply(_inv.copy(arm.restQ.hand).invert())
  if (_relative.w < 0) _relative.set(-_relative.x, -_relative.y, -_relative.z, -_relative.w)
  const dot = _relative.x * arm.axis.fore.x + _relative.y * arm.axis.fore.y + _relative.z * arm.axis.fore.z
  const requested = 2 * Math.atan2(dot, _relative.w)
  // Positive physiological angle means supination on either arm.
  const twist = -arm.side * THREE.MathUtils.clamp(-arm.side * requested, -PRONATION, SUPINATION)
  _foreWorld.copy(_neutral).multiply(_twist.setFromAxisAngle(arm.axis.fore, twist))
  _handLocal.copy(_foreWorld).invert().multiply(desired)
    .multiply(_inv.copy(arm.restQ.hand).invert())
  const angle = _identity.angleTo(_handLocal)
  const limit = THREE.MathUtils.clamp(maxWrist, 0.65, 1.22)
  if (angle > limit) _handLocal.slerp(_identity, 1 - limit / angle)
  _handLocal.multiply(arm.restQ.hand)
  return Math.max(0, angle - limit)
}
const _inv = new THREE.Quaternion(), _twist = new THREE.Quaternion()

/** Conservative torso envelope in arm-reach units. Contact targets remain
 * exact; avoid passing the intervening arm through the chest/abdomen. The
 * shoulder attachment and wrist contact themselves are excluded. */
function torsoPenalty(arm: ArmChain, shoulder: THREE.Vector3, elbow: THREE.Vector3, wrist: THREE.Vector3) {
  const reach = arm.upperLen + arm.foreLen
  const centerX = shoulder.x - arm.side * 0.35 * reach
  let penalty = 0
  for (let segment = 0; segment < 2; segment++) {
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      _clearancePoint.lerpVectors(segment === 0 ? shoulder : elbow, segment === 0 ? elbow : wrist, t)
      const y = (_clearancePoint.y - shoulder.y) / reach
      if (y > 0.02 || y < -0.88) continue
      const x = (_clearancePoint.x - centerX) / (0.30 * reach)
      const z = (_clearancePoint.z - shoulder.z + 0.025 * reach) / (0.245 * reach)
      const depth = Math.max(0, 1 - x * x - z * z)
      penalty += depth * depth
    }
  }
  return penalty
}

/** Solve the remaining shoulder swivel only when the preferred elbow cannot
 * deliver the requested orientation. Penalise displacement and reject elbows
 * through the chest or above the shoulder; never relax wrist position. */
function chooseElbow(
  arm: ArmChain, shoulder: THREE.Vector3, wrist: THREE.Vector3, aim: THREE.Vector3,
  upper: THREE.Vector3, desired: THREE.Quaternion, maxWrist: number,
) {
  _preferredUpper.copy(upper)
  _candidateElbow.copy(shoulder).addScaledVector(upper, arm.upperLen)
  _candidateFore.subVectors(wrist, _candidateElbow).normalize()
  if (orientAt(arm, upper, _candidateFore, desired, maxWrist) < 0.002
      && torsoPenalty(arm, shoulder, _candidateElbow, wrist) === 0) return
  _orientationDelta.copy(desired).multiply(_inv.copy(arm.handRestWorldQ).invert())
  _desiredPalm.copy(arm.palmNormal).applyQuaternion(_orientationDelta)
  _desiredPoint.copy(arm.along).applyQuaternion(_orientationDelta)
  const reach = arm.upperLen + arm.foreLen
  let best = Infinity, bestAngle = 0
  const score = (angle: number) => {
    _candidateUpper.copy(_preferredUpper).applyAxisAngle(aim, angle)
    _candidateElbow.copy(shoulder).addScaledVector(_candidateUpper, arm.upperLen)
    if (angle !== 0 && (arm.side * (_candidateElbow.x - shoulder.x) < -0.10 * reach
        || _candidateElbow.y > shoulder.y + 0.16 * reach
        || _candidateElbow.z < shoulder.z - 0.12 * reach)) return
    _candidateFore.subVectors(wrist, _candidateElbow).normalize()
    orientAt(arm, _candidateUpper, _candidateFore, desired, maxWrist)
    _orientationDelta.copy(_foreWorld).multiply(_handLocal)
      .multiply(_inv.copy(arm.handRestWorldQ).invert())
    _solvedPalm.copy(arm.palmNormal).applyQuaternion(_orientationDelta)
    _solvedPoint.copy(arm.along).applyQuaternion(_orientationDelta)
    const error = 4 * (1 - _solvedPalm.dot(_desiredPalm)) + (1 - _solvedPoint.dot(_desiredPoint))
      + 0.0005 * angle * angle
      + 20 * torsoPenalty(arm, shoulder, _candidateElbow, wrist)
    if (error < best) { best = error; bestAngle = angle; _bestUpper.copy(_candidateUpper) }
  }
  score(0)
  for (let k = 1; k <= 12; k++) { score(k * Math.PI / 12); score(-k * Math.PI / 12) }
  for (const step of [Math.PI / 48, Math.PI / 192]) {
    const center = bestAngle
    for (let k = -3; k <= 3; k++) score(center + k * step)
  }
  upper.copy(_bestUpper)
}

export function setHandOrientation(
  arm: ArmChain, palm: THREE.Vector3, point: THREE.Vector3, dt: number,
  maxWristSwing = MAX_WRIST_SWING,
) {
  desiredHand(arm, palm, point, _orientationWant)
  orientAt(arm, arm.ikUpper, arm.ikFore, _orientationWant, maxWristSwing)
  arm.fore.parent?.getWorldQuaternion(_pq)
  _foreLocal.copy(_pq).invert().multiply(_foreWorld)
  slerpLimited(arm.fore.quaternion, _foreLocal, dt, ARM_LAMBDA, ARM_MAX_RAD_S)
  // Damping may lag pronation, but it must not lag the forearm's IK direction.
  _rw.copy(_pq).multiply(arm.fore.quaternion)
  _cur.copy(arm.axis.fore).applyQuaternion(_rw).normalize()
  _aimCorrection.setFromUnitVectors(_cur, arm.ikFore)
  _rw.premultiply(_aimCorrection)
  arm.fore.quaternion.copy(_pq.invert()).multiply(_rw)
  arm.fore.updateMatrixWorld(true)
  slerpLimited(arm.hand.quaternion, _handLocal, dt, WRIST_LAMBDA, WRIST_MAX_RAD_S)
  arm.hand.updateMatrixWorld(true)
}

export type FingerTarget = { curl: readonly [number, number, number]; spread: number }

const FINGER_JOINT_MAX = [1.34, 1.48, 1.02]

/**
 * Anatomical joint limits, enforced here rather than trusted from the pose data.
 *
 * The MCP, PIP and DIP joints are not independent. The PIP and DIP are hinges
 * with essentially no extension range, and the DIP is tendon-coupled to the PIP
 * through flexor digitorum profundus: you cannot fold the fingertip while the
 * middle joint stays straight. Try it on your own hand. A pose that asks for it
 * reads as broken even when every individual angle is inside its own limit,
 * which is how a descriptor-derived handshape ends up looking like a claw.
 *
 * Clamping at the point of application means NO pose - authored, composed, or
 * later imported from capture - can put the hand outside human range. That is
 * the guarantee worth having, because the pose data will keep changing.
 */
function anatomicalCurl(curl: readonly number[]): [number, number, number] {
  const mcp = THREE.MathUtils.clamp(curl[0] ?? 0, 0, FINGER_JOINT_MAX[0])
  const pip = THREE.MathUtils.clamp(curl[1] ?? 0, 0, FINGER_JOINT_MAX[1])
  // The DIP follows the PIP and cannot lead it.
  const dipMax = Math.min(FINGER_JOINT_MAX[2], pip * 0.72 + 0.12)
  const dip = THREE.MathUtils.clamp(curl[2] ?? 0, 0, dipMax)
  return [mcp, pip, dip]
}

function applyFinger(chain: FingerChain, t: FingerTarget, dt: number, lambda = FINGER_LAMBDA) {
  const curl = anatomicalCurl(t.curl)
  for (let i = 0; i < chain.bones.length; i++) {
    const b = chain.bones[i]
    const requested = curl[i] ?? curl[curl.length - 1] * 0.7
    const angle = THREE.MathUtils.clamp(requested, 0, FINGER_JOINT_MAX[i] ?? 1.02) * chain.curlSign
    _dq.setFromAxisAngle(chain.curlAxis[i], angle)
    _want.copy(chain.restQ[i]).multiply(_dq)
    if (i === 0 && t.spread) {
      _dq.setFromAxisAngle(chain.spreadAxis,
        THREE.MathUtils.clamp(t.spread, -.34, .34) * chain.spreadSign)
      _want.multiply(_dq)
    }
    slerpLimited(b.quaternion, _want, dt, lambda, FINGER_MAX_RAD_S)
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
  _dq.setFromAxisAngle(chain.spreadAxis,
    THREE.MathUtils.clamp(t.abduct, -.08, .86) * chain.spreadSign)
  _want.multiply(_dq)
  _dq.setFromAxisAngle(chain.longAxis, THREE.MathUtils.clamp(t.rotate, -.15, .88))
  _want.multiply(_dq)
  _dq.setFromAxisAngle(chain.curlAxis[0], THREE.MathUtils.clamp(t.curl[0], 0, 1.02) * chain.curlSign)
  _want.multiply(_dq)
  slerpLimited(base.quaternion, _want, dt, lambda, FINGER_MAX_RAD_S)

  for (let i = 1; i < chain.bones.length; i++) {
    const requested = i === 1 ? t.curl[1] : t.curl[1] * 0.7
    const angle = THREE.MathUtils.clamp(requested, 0, i === 1 ? 1.12 : .82) * chain.curlSign
    _dq.setFromAxisAngle(chain.curlAxis[i], angle)
    _want.copy(chain.restQ[i]).multiply(_dq)
    slerpLimited(chain.bones[i].quaternion, _want, dt, lambda, FINGER_MAX_RAD_S)
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

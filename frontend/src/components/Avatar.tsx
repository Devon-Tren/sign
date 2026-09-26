import { poseAt } from '../playback'
import type { PlaybackTimeline } from '../types'
/**
 * Illustrative 3D avatar.
 *
 * The rig is articulated enough to express the ASL-LEX phonological
 * descriptors in ../clips: three flexion joints and an abduction joint per
 * finger, an opposable thumb, and two-bone IK so a sign can be placed at a
 * body location rather than posed by eye.
 *
 * The motions remain UNVERIFIED placeholders, not authentic ASL.
 */
import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { motionFor, type HandPose, type Pose } from '../clips'

type AvatarProps = { timeline?: PlaybackTimeline; onComplete?: () => void; clipId: string; paused?: boolean; speed?: number; compact?: boolean; showGround?: boolean }

const SKIN = '#c89877'
const SKIN_LIGHT = '#dcb18f'
const NAIL = '#e7c4a6'
const TEAL = '#a8d9bb'
const DEEP = '#163835'
const DARK = '#152320'

const UPPER_ARM = 0.58
const FOREARM = 0.5
const SHOULDER_Y = 2.26
const SHOULDER_X = 0.73

// Finger metrics: [base x offset, proximal, middle, distal, radius]
const FINGERS = [
  { x: -0.15, seg: [0.2, 0.14, 0.1], r: 0.05 },
  { x: -0.05, seg: [0.22, 0.155, 0.1], r: 0.05 },
  { x: 0.05, seg: [0.2, 0.14, 0.095], r: 0.047 },
  { x: 0.145, seg: [0.16, 0.11, 0.08], r: 0.042 },
]

type HandRig = { joints: THREE.Group[][]; spreads: THREE.Group[]; thumb: THREE.Group[] }

function Finger({ index, rigRef }: { index: number; rigRef: MutableRefObject<HandRig> }) {
  const spec = FINGERS[index]
  const register = (depth: number) => (el: THREE.Group | null) => {
    if (el) rigRef.current.joints[index][depth] = el
  }
  return (
    <group
      position={[spec.x, -0.16, 0]}
      ref={(el) => { if (el) rigRef.current.spreads[index] = el }}
    >
      <group ref={register(0)}>
        <mesh position={[0, -spec.seg[0] / 2, 0]} castShadow>
          <capsuleGeometry args={[spec.r, spec.seg[0], 4, 12]} />
          <meshStandardMaterial color={SKIN_LIGHT} roughness={0.72} />
        </mesh>
        <group position={[0, -spec.seg[0], 0]} ref={register(1)}>
          <mesh position={[0, -spec.seg[1] / 2, 0]} castShadow>
            <capsuleGeometry args={[spec.r * 0.92, spec.seg[1], 4, 12]} />
            <meshStandardMaterial color={SKIN_LIGHT} roughness={0.72} />
          </mesh>
          <group position={[0, -spec.seg[1], 0]} ref={register(2)}>
            <mesh position={[0, -spec.seg[2] / 2, 0]} castShadow>
              <capsuleGeometry args={[spec.r * 0.84, spec.seg[2], 4, 12]} />
              <meshStandardMaterial color={SKIN_LIGHT} roughness={0.7} />
            </mesh>
            <mesh position={[0, -spec.seg[2] * 0.72, spec.r * 0.5]} scale={[0.75, 1, 0.4]}>
              <sphereGeometry args={[spec.r * 0.62, 10, 8]} />
              <meshStandardMaterial color={NAIL} roughness={0.42} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

function Hand({ side, rigRef }: { side: 'left' | 'right'; rigRef: MutableRefObject<HandRig> }) {
  const mirror = side === 'left' ? -1 : 1
  return (
    <group scale={[mirror, 1, 1]}>
      {/* palm */}
      <mesh position={[0, -0.075, 0]} castShadow>
        <boxGeometry args={[0.38, 0.3, 0.135]} />
        <meshStandardMaterial color={SKIN} roughness={0.78} />
      </mesh>
      <mesh position={[0, -0.16, 0]} castShadow>
        <boxGeometry args={[0.36, 0.14, 0.12]} />
        <meshStandardMaterial color={SKIN} roughness={0.78} />
      </mesh>
      {FINGERS.map((_, i) => <Finger key={i} index={i} rigRef={rigRef} />)}
      {/* thumb: abduction + opposition at the base, two flexion joints */}
      <group
        position={[-0.19, -0.03, 0.03]}
        ref={(el) => { if (el) rigRef.current.thumb[0] = el }}
      >
        <mesh position={[0, -0.09, 0]} castShadow>
          <capsuleGeometry args={[0.058, 0.17, 4, 12]} />
          <meshStandardMaterial color={SKIN} roughness={0.75} />
        </mesh>
        <group position={[0, -0.175, 0]} ref={(el) => { if (el) rigRef.current.thumb[1] = el }}>
          <mesh position={[0, -0.07, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.13, 4, 12]} />
            <meshStandardMaterial color={SKIN_LIGHT} roughness={0.72} />
          </mesh>
          <mesh position={[0, -0.12, 0.03]} scale={[0.8, 1, 0.4]}>
            <sphereGeometry args={[0.04, 10, 8]} />
            <meshStandardMaterial color={NAIL} roughness={0.42} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function Arm({ side, refs }: {
  side: 'left' | 'right'
  refs: { shoulder: MutableRefObject<THREE.Group | null>; elbow: MutableRefObject<THREE.Group | null>; wrist: MutableRefObject<THREE.Group | null>; hand: MutableRefObject<HandRig> }
}) {
  const dir = side === 'left' ? -1 : 1
  return (
    <group position={[dir * SHOULDER_X, SHOULDER_Y, 0]} ref={refs.shoulder}>
      <mesh position={[0, -0.02, 0]} castShadow>
        <sphereGeometry args={[0.2, 20, 16]} />
        <meshStandardMaterial color={TEAL} roughness={0.85} />
      </mesh>
      <mesh position={[0, -UPPER_ARM / 2, 0]} castShadow>
        <capsuleGeometry args={[0.165, UPPER_ARM - 0.12, 6, 16]} />
        <meshStandardMaterial color={TEAL} roughness={0.85} />
      </mesh>
      <group position={[0, -UPPER_ARM, 0]} ref={refs.elbow}>
        <mesh castShadow>
          <sphereGeometry args={[0.152, 18, 14]} />
          <meshStandardMaterial color={SKIN} roughness={0.76} />
        </mesh>
        <mesh position={[0, -FOREARM / 2, 0]} castShadow>
          <capsuleGeometry args={[0.135, FOREARM - 0.1, 6, 16]} />
          <meshStandardMaterial color={SKIN} roughness={0.76} />
        </mesh>
        <group position={[0, -FOREARM, 0]} ref={refs.wrist}>
          <group scale={0.74}>
            <Hand side={side} rigRef={refs.hand} />
          </group>
        </group>
      </group>
    </group>
  )
}

const newHandRig = (): HandRig => ({
  joints: [[], [], [], []],
  spreads: [],
  thumb: [],
})

// Scratch objects reused every frame - this runs alongside live transcription,
// so the render loop must not allocate.
const _delta = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _bendAxis = new THREE.Vector3()
const _upper = new THREE.Vector3()
const _ax = new THREE.Vector3()
const _ay = new THREE.Vector3()
const _az = new THREE.Vector3()
const _target = new THREE.Vector3()
const _shoulder = new THREE.Vector3()
const _basis = new THREE.Matrix4()
const _qOut = new THREE.Quaternion()
const _qArm = new THREE.Quaternion()
const _qDesired = new THREE.Quaternion()
const REST_TARGET_R = new THREE.Vector3(SHOULDER_X + 0.2, 1.12, 0.24)
const REST_TARGET_L = new THREE.Vector3(-SHOULDER_X - 0.2, 1.12, 0.24)
const REST_PALM_R = new THREE.Vector3(-0.85, 0, 0.5)
const REST_PALM_L = new THREE.Vector3(0.85, 0, 0.5)
const REST_POINT = new THREE.Vector3(0, -1, 0.1)
const _palmA = new THREE.Vector3()
const _palmB = new THREE.Vector3()
const _pointA = new THREE.Vector3()
const _pointB = new THREE.Vector3()

/**
 * Two-bone IK. `side` picks a pole vector so the elbow hangs down and outward
 * instead of swinging through the torso, and the shoulder basis is built
 * explicitly so the elbow's local X axis is the bend axis.
 */
function solveArm(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  side: number,
  shoulderGroup: THREE.Group,
  elbowGroup: THREE.Group,
  delta: number,
) {
  _delta.subVectors(target, shoulder)
  const reach = UPPER_ARM + FOREARM
  const d = THREE.MathUtils.clamp(_delta.length(), Math.abs(UPPER_ARM - FOREARM) + 0.1, reach - 0.04)
  _dir.copy(_delta).normalize()

  const cosElbow = (UPPER_ARM * UPPER_ARM + FOREARM * FOREARM - d * d) / (2 * UPPER_ARM * FOREARM)
  const elbowBend = Math.PI - Math.acos(THREE.MathUtils.clamp(cosElbow, -1, 1))
  const cosShoulder = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d)
  const shoulderOffset = Math.acos(THREE.MathUtils.clamp(cosShoulder, -1, 1))

  // Elbow pole: down, outward from the midline, slightly behind.
  _pole.set(side * 0.95, -1, -0.26).normalize()
  _bendAxis.crossVectors(_dir, _pole)
  if (_bendAxis.lengthSq() < 1e-6) _bendAxis.set(side, 0, 0)
  _bendAxis.normalize()

  // Rotating `dir` about this axis moves it toward the pole, putting the
  // elbow on the outside of the arc.
  _upper.copy(_dir).applyAxisAngle(_bendAxis, shoulderOffset)
  _ay.copy(_upper).negate()          // the arm hangs along local -Y
  _az.crossVectors(_bendAxis, _ay)
  _basis.makeBasis(_bendAxis, _ay, _az)
  _qOut.setFromRotationMatrix(_basis)

  shoulderGroup.quaternion.slerp(_qOut, 1 - Math.exp(-12 * delta))
  elbowGroup.rotation.x = THREE.MathUtils.damp(elbowGroup.rotation.x, -elbowBend, 12, delta)
}

/**
 * Orient the hand so the palm faces `palm` and the fingers point along
 * `point`, regardless of how the IK happened to roll the arm. Palm
 * orientation carries meaning in ASL, so it cannot be left to fall out of
 * the solver.
 */
function applyWrist(
  wrist: THREE.Group,
  shoulderGroup: THREE.Group,
  elbowGroup: THREE.Group,
  palm: THREE.Vector3,
  point: THREE.Vector3,
  delta: number,
) {
  _ay.copy(point).normalize().negate()             // hand's -Y points at `point`
  _az.copy(palm).normalize()                       // hand's +Z is the palm normal
  _az.addScaledVector(_ay, -_az.dot(_ay))
  if (_az.lengthSq() < 1e-6) return
  _az.normalize()
  _ax.crossVectors(_ay, _az)
  _basis.makeBasis(_ax, _ay, _az)
  _qDesired.setFromRotationMatrix(_basis)

  // Parent chain has no rotation above the shoulder, so the forearm's world
  // orientation is simply shoulder * elbow.
  _qArm.copy(shoulderGroup.quaternion).multiply(elbowGroup.quaternion).invert()
  _qDesired.premultiply(_qArm)
  wrist.quaternion.slerp(_qDesired, 1 - Math.exp(-11 * delta))
}

function applyHand(rig: HandRig, pose: HandPose, delta: number, lambda = 14) {
  for (let i = 0; i < 4; i++) {
    const finger = pose.fingers[i]
    if (!finger) continue
    const chain = rig.joints[i]
    for (let j = 0; j < 3; j++) {
      const joint = chain[j]
      if (joint) joint.rotation.x = THREE.MathUtils.damp(joint.rotation.x, finger.curl[j], lambda, delta)
    }
    const spread = rig.spreads[i]
    if (spread) spread.rotation.z = THREE.MathUtils.damp(spread.rotation.z, -finger.spread, lambda, delta)
  }
  const [base, mid] = rig.thumb
  if (base) {
    base.rotation.z = THREE.MathUtils.damp(base.rotation.z, pose.thumb.abduct, lambda, delta)
    base.rotation.y = THREE.MathUtils.damp(base.rotation.y, -pose.thumb.rotate, lambda, delta)
    base.rotation.x = THREE.MathUtils.damp(base.rotation.x, pose.thumb.curl[0], lambda, delta)
  }
  if (mid) mid.rotation.x = THREE.MathUtils.damp(mid.rotation.x, pose.thumb.curl[1], lambda, delta)
}

function Model({ clipId, paused, speed, timeline, onComplete }: AvatarProps & {paused: boolean; speed: number}) {
  const right = {
    shoulder: useRef<THREE.Group | null>(null),
    elbow: useRef<THREE.Group | null>(null),
    wrist: useRef<THREE.Group | null>(null),
    hand: useRef<HandRig>(newHandRig()),
  }
  const left = {
    shoulder: useRef<THREE.Group | null>(null),
    elbow: useRef<THREE.Group | null>(null),
    wrist: useRef<THREE.Group | null>(null),
    hand: useRef<HandRig>(newHandRig()),
  }
  const neck = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const brows = useRef<THREE.Group>(null)
  const mouth = useRef<THREE.Mesh>(null)
  const elapsed = useRef(0)
  const finished = useRef(false)

  useEffect(() => { elapsed.current = 0; finished.current = false }, [clipId, timeline])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.07)
    if (!paused) elapsed.current += delta * speed
    if (timeline && elapsed.current * 1000 >= timeline.duration_ms && !finished.current) {
      finished.current = true
      onComplete?.()
    }
    const pose: Pose = timeline ? poseAt(timeline, elapsed.current * 1000) : motionFor(clipId, elapsed.current)

    _shoulder.set(SHOULDER_X, SHOULDER_Y, 0)
    if (right.shoulder.current && right.elbow.current) {
      if (pose.rightArm) _target.set(...pose.rightArm.target)
      else _target.copy(REST_TARGET_R)
      solveArm(_shoulder, _target, 1, right.shoulder.current, right.elbow.current, delta)
      if (right.wrist.current) {
        const palm = pose.rightArm ? _palmA.set(...pose.rightArm.palm) : REST_PALM_R
        const point = pose.rightArm ? _pointA.set(...pose.rightArm.point) : REST_POINT
        applyWrist(right.wrist.current, right.shoulder.current, right.elbow.current, palm, point, delta)
      }
    }
    _shoulder.set(-SHOULDER_X, SHOULDER_Y, 0)
    if (left.shoulder.current && left.elbow.current) {
      if (pose.leftArm) _target.set(...pose.leftArm.target)
      else _target.copy(REST_TARGET_L)
      solveArm(_shoulder, _target, -1, left.shoulder.current, left.elbow.current, delta)
      if (left.wrist.current) {
        const palm = pose.leftArm ? _palmB.set(...pose.leftArm.palm) : REST_PALM_L
        const point = pose.leftArm ? _pointB.set(...pose.leftArm.point) : REST_POINT
        applyWrist(left.wrist.current, left.shoulder.current, left.elbow.current, palm, point, delta)
      }
    }

    applyHand(right.hand.current, pose.rightHand, delta)
    applyHand(left.hand.current, pose.leftHand, delta)

    if (neck.current) {
      neck.current.rotation.x = THREE.MathUtils.damp(neck.current.rotation.x, pose.head[0], 8, delta)
      neck.current.rotation.y = THREE.MathUtils.damp(neck.current.rotation.y, pose.head[1], 8, delta)
      neck.current.rotation.z = THREE.MathUtils.damp(neck.current.rotation.z, pose.head[2], 8, delta)
    }
    if (torso.current) torso.current.rotation.z = THREE.MathUtils.damp(torso.current.rotation.z, pose.torso, 8, delta)
    // Non-manual markers: brow raise and a small mouth morph.
    if (brows.current) {
      brows.current.position.y = THREE.MathUtils.damp(brows.current.position.y, 0.5 + pose.brow * 0.05, 9, delta)
      brows.current.rotation.z = THREE.MathUtils.damp(brows.current.rotation.z, pose.brow * 0.08, 9, delta)
    }
    if (mouth.current) {
      const open = 0.024 + pose.mouth * 0.05
      mouth.current.scale.y = THREE.MathUtils.damp(mouth.current.scale.y, open, 9, delta)
    }
  })

  return (
    <group position={[0, -1.1, 0]}>
      <group ref={torso}>
        <mesh position={[0, 1.95, 0]} castShadow>
          <cylinderGeometry args={[0.59, 0.47, 1.0, 28]} />
          <meshStandardMaterial color={TEAL} roughness={0.84} />
        </mesh>
        <mesh position={[0, 1.62, 0.44]}>
          <boxGeometry args={[0.14, 0.23, 0.025]} />
          <meshStandardMaterial color={DEEP} roughness={0.7} />
        </mesh>
        <mesh position={[0, 1.47, 0]}>
          <cylinderGeometry args={[0.46, 0.44, 0.16, 24]} />
          <meshStandardMaterial color={DARK} roughness={0.8} />
        </mesh>
        <mesh position={[-0.2, 0.98, 0]} castShadow>
          <capsuleGeometry args={[0.23, 0.65, 6, 16]} />
          <meshStandardMaterial color={DEEP} roughness={0.85} />
        </mesh>
        <mesh position={[0.2, 0.98, 0]} castShadow>
          <capsuleGeometry args={[0.23, 0.65, 6, 16]} />
          <meshStandardMaterial color={DEEP} roughness={0.85} />
        </mesh>
        <mesh position={[-0.2, 0.43, 0.04]} castShadow>
          <capsuleGeometry args={[0.22, 0.65, 6, 16]} />
          <meshStandardMaterial color={DARK} roughness={0.85} />
        </mesh>
        <mesh position={[0.2, 0.43, 0.04]} castShadow>
          <capsuleGeometry args={[0.22, 0.65, 6, 16]} />
          <meshStandardMaterial color={DARK} roughness={0.85} />
        </mesh>
        <mesh position={[-0.2, 0.03, 0.18]} castShadow>
          <boxGeometry args={[0.43, 0.18, 0.65]} />
          <meshStandardMaterial color="#243c35" roughness={0.9} />
        </mesh>
        <mesh position={[0.2, 0.03, 0.18]} castShadow>
          <boxGeometry args={[0.43, 0.18, 0.65]} />
          <meshStandardMaterial color="#243c35" roughness={0.9} />
        </mesh>
      </group>

      <group ref={neck} position={[0, 2.56, 0]}>
        <mesh position={[0, -0.05, 0]}>
          <cylinderGeometry args={[0.19, 0.18, 0.36, 20]} />
          <meshStandardMaterial color={SKIN} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.35, 0.015]} castShadow>
          <sphereGeometry args={[0.47, 40, 32]} />
          <meshStandardMaterial color={SKIN_LIGHT} roughness={0.84} />
        </mesh>
        <mesh position={[0, 0.63, -0.02]} scale={[0.48, 0.23, 0.44]}>
          <sphereGeometry args={[1, 28, 20]} />
          <meshStandardMaterial color="#302d29" roughness={1} />
        </mesh>
        {/* eyes */}
        <mesh position={[-0.2, 0.37, 0.438]} scale={[0.055, 0.07, 0.032]}>
          <sphereGeometry args={[1, 14, 12]} />
          <meshStandardMaterial color="#293a31" roughness={0.3} />
        </mesh>
        <mesh position={[0.2, 0.37, 0.438]} scale={[0.055, 0.07, 0.032]}>
          <sphereGeometry args={[1, 14, 12]} />
          <meshStandardMaterial color="#293a31" roughness={0.3} />
        </mesh>
        {/* brows - carry the non-manual marker */}
        <group ref={brows} position={[0, 0.5, 0]}>
          <mesh position={[-0.2, 0, 0.44]} rotation={[0, 0, 0.12]} scale={[0.085, 0.017, 0.02]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#3a332c" roughness={0.95} />
          </mesh>
          <mesh position={[0.2, 0, 0.44]} rotation={[0, 0, -0.12]} scale={[0.085, 0.017, 0.02]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#3a332c" roughness={0.95} />
          </mesh>
        </group>
        <mesh position={[0, 0.23, 0.475]} scale={[0.08, 0.07, 0.045]}>
          <sphereGeometry args={[1, 14, 12]} />
          <meshStandardMaterial color={SKIN} roughness={0.8} />
        </mesh>
        <mesh ref={mouth} position={[0, 0.11, 0.43]} scale={[0.16, 0.024, 0.02]}>
          <sphereGeometry args={[1, 18, 10]} />
          <meshStandardMaterial color="#925f59" roughness={0.6} />
        </mesh>
        <mesh position={[-0.46, 0.35, -0.02]} scale={[0.09, 0.16, 0.09]}>
          <sphereGeometry args={[1, 16, 14]} />
          <meshStandardMaterial color={SKIN} roughness={0.8} />
        </mesh>
        <mesh position={[0.46, 0.35, -0.02]} scale={[0.09, 0.16, 0.09]}>
          <sphereGeometry args={[1, 16, 14]} />
          <meshStandardMaterial color={SKIN} roughness={0.8} />
        </mesh>
      </group>

      <Arm side="left" refs={left} />
      <Arm side="right" refs={right} />
    </group>
  )
}

export default function Avatar({ clipId, paused = false, speed = 1, compact = false, showGround = true, timeline, onComplete }: AvatarProps) {
  // Radial falloff for the ground pad, built once.
  const groundTexture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(22,56,53,0.30)')
    grad.addColorStop(0.55, 'rgba(22,56,53,0.12)')
    grad.addColorStop(1, 'rgba(22,56,53,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])

  return (
    <div
      className="avatar-canvas"
      role="img"
      aria-label="Articulated illustrative 3D person. Motions are composed from published phonological descriptors and are unverified placeholders, not authentic ASL."
    >
      <Canvas
        shadows
        camera={{ position: [0, 1.2, compact ? 5.5 : 5.1], fov: 38 }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
        dpr={[1, 1.75]}
        onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}
      >
        <Suspense fallback={null}>
          {/* Sky/ground ambient keeps the underside of the hands readable. */}
          <hemisphereLight args={['#eaf6ee', '#5d7a6d', 1.15]} />
          {/* Key light: the only shadow caster, aimed to separate hands from torso. */}
          <directionalLight
            position={[3.2, 5.4, 4.2]}
            intensity={2.15}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0009}
            shadow-normalBias={0.022}
          >
            <orthographicCamera attach="shadow-camera" args={[-3, 3, 3.6, -2.4, 0.5, 16]} />
          </directionalLight>
          {/* Cool fill from the opposite side. */}
          <directionalLight position={[-4.2, 2.4, -2.6]} color="#9accb3" intensity={0.95} />
          {/* Rim light: puts a bright edge on the hands so handshapes read
              against the torso, which is the whole point of the render. */}
          <directionalLight position={[-1.4, 2.6, -4.4]} color="#ffffff" intensity={1.35} />
          <pointLight position={[0, 2.1, 2.4]} intensity={0.5} distance={7} decay={2} color="#fff4e8" />

          {showGround && (
            <>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.18, 0]} receiveShadow>
                <circleGeometry args={[2.6, 64]} />
                <meshStandardMaterial color="#dce9da" roughness={1} transparent opacity={0.5} />
              </mesh>
              {groundTexture && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.172, 0.05]}>
                  <planeGeometry args={[3.4, 3.4]} />
                  <meshBasicMaterial map={groundTexture} transparent depthWrite={false} />
                </mesh>
              )}
            </>
          )}

          <Model clipId={clipId} paused={paused} speed={speed} timeline={timeline} onComplete={onComplete} />
          <OrbitControls
            target={[0, 0.62, 0]}
            enablePan={false}
            minDistance={2.8}
            maxDistance={7.5}
            minPolarAngle={0.55}
            maxPolarAngle={2}
            enableDamping
          />
        </Suspense>
      </Canvas>
    </div>
  )
}

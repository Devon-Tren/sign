/**
 * Illustrative 3D signer.
 *
 * The character is a Microsoft Rocketbox avatar (MIT licensed - see NOTICE),
 * driven by the pose schema in ../clips. The motions remain UNVERIFIED
 * placeholders composed from published phonological descriptors, not
 * authentic ASL.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  loadSigner, solveArmIK, setHandOrientation, applyHand, setMorph,
  applySpine, applyHead, applyGazeTarget, setMorphDirect, smoothTarget,
  type ArmChain, type SignerRig,
} from '../signerRig'
import { motionFor, idlePose, blendPoses, breathAt, type Pose, type Vec3 } from '../clips'
import { poseAt } from '../playback'
import type { PlaybackTimeline } from '../types'

/**
 * ../clips emits positions in a normalised body frame: origin at the shoulder
 * midpoint, unit of one arm reach, +x toward the dominant hand, +y up,
 * +z forward. This rig is modelled facing +z, which in a right-handed frame
 * puts the character's RIGHT at -x - hence DOMINANT_X.
 */
const DOMINANT_X = -1

type AvatarProps = {
  clipId: string
  paused?: boolean
  speed?: number
  compact?: boolean
  showGround?: boolean
  /** Review-gated playback: a backend-planned timeline overrides clipId. */
  timeline?: PlaybackTimeline
  onComplete?: () => void
}

/** The FBX is parsed once and the result shared by every Avatar instance. */
let signerPromise: Promise<SignerRig> | null = null
function getSigner() {
  if (!signerPromise) signerPromise = loadSigner()
  return signerPromise
}

const _t = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()
const _shL = new THREE.Vector3()
const _shR = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _gazeTarget = new THREE.Vector3()
const _eyeA = new THREE.Vector3()
const _eyeB = new THREE.Vector3()

/** Normalised body-frame position -> world. */
function toWorld(rig: SignerRig, n: Vec3, out: THREE.Vector3) {
  rig.left.upper.getWorldPosition(_shL)
  rig.right.upper.getWorldPosition(_shR)
  _mid.addVectors(_shL, _shR).multiplyScalar(0.5)
  const reach = rig.right.upperLen + rig.right.foreLen
  return out.set(
    _mid.x + n[0] * DOMINANT_X * reach,
    _mid.y + n[1] * reach,
    _mid.z + n[2] * reach,
  )
}

/** Direction vectors live in the same frame, so x flips with the body. */
const toDir = (d: Vec3, out: THREE.Vector3) => out.set(d[0] * DOMINANT_X, d[1], d[2]).normalize()

/** How long to cross-fade when the displayed sign changes. */
const FADE_S = 0.18

/**
 * Blink and gaze timing.
 *
 * Nothing here is periodic on purpose. A blink on a fixed timer, or eyes that
 * track perfectly, read as more mechanical than no motion at all - which is the
 * main risk of adding this kind of detail.
 */
const BLINK_MIN = 2.5, BLINK_MAX = 6.0, BLINK_DUR = 0.13
const SACCADE_MIN = 0.8, SACCADE_MAX = 2.0
const rand = (a: number, b: number) => a + Math.random() * (b - a)

type Life = {
  nextBlink: number
  blinkT: number
  doubleBlink: boolean
  nextSaccade: number
  gaze: { pitch: number; yaw: number }
}

function Signer({ clipId, paused, speed, timeline, onComplete }: AvatarProps & { paused: boolean; speed: number }) {
  const [rig, setRig] = useState<SignerRig | null>(null)
  const elapsed = useRef(0)
  // Cross-fade state. `shown` tracks what the frame loop last rendered, because
  // the clipId effect below closes over the INCOMING id, not the outgoing one.
  const shown = useRef<{ clip: string; at: number }>({ clip: clipId, at: 0 })
  const prev = useRef<{ clip: string; at: number } | null>(null)
  const fade = useRef(1)
  const life = useRef<Life>({
    nextBlink: rand(BLINK_MIN, BLINK_MAX), blinkT: -1, doubleBlink: false,
    nextSaccade: rand(SACCADE_MIN, SACCADE_MAX), gaze: { pitch: 0, yaw: 0 },
  })
  const clock = useRef(0)
  const finished = useRef(false)

  useEffect(() => {
    let alive = true
    getSigner().then((r) => { if (alive) setRig(r) }).catch((e) => console.error('signer load failed', e))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    // Freeze the sign that was on screen and fade from it, rather than cutting.
    prev.current = { ...shown.current }
    fade.current = 0
    elapsed.current = 0
    finished.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, timeline])

  useFrame((_, rawDelta) => {
    if (!rig) return
    const dt = Math.min(rawDelta, 0.07)
    clock.current += dt
    if (!paused) elapsed.current += dt * speed

    let pose: Pose
    if (timeline) {
      // A planned timeline sequences its own clips, so the per-clip cross-fade
      // does not apply; poseAt handles the switching.
      const ms = elapsed.current * 1000
      if (ms >= timeline.duration_ms && !finished.current) {
        finished.current = true
        onComplete?.()
      }
      pose = poseAt(timeline, ms)
    } else {
      shown.current = { clip: clipId, at: elapsed.current }
      pose = motionFor(clipId, elapsed.current)
      if (fade.current < 1 && prev.current) {
        fade.current = Math.min(1, fade.current + dt / FADE_S)
        const outgoing = motionFor(prev.current.clip, prev.current.at)
        const t = fade.current
        pose = blendPoses(outgoing, pose, t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
      }
    }

    const idle = idlePose(elapsed.current)

    // Spine first: the arms hang off it, so IK must see the updated shoulders.
    applySpine(rig.face, pose.torso, breathAt(elapsed.current) * 0.018, dt)

    const drive = (a: ArmChain, sign: number, arm: Vec3[] | null, fallback: Vec3[]) => {
      const [target, palm, point] = arm ?? fallback
      toWorld(rig, target, _t)
      solveArmIK(a, smoothTarget(a, _t, dt), sign, dt)
      setHandOrientation(a, toDir(palm, _p), toDir(point, _q), dt)
    }
    const unpack = (a: Pose['rightArm']): Vec3[] | null => (a ? [a.target, a.palm, a.point] : null)
    const idleR = unpack(idle.rightArm)!
    const idleL = unpack(idle.leftArm)!

    drive(rig.right, DOMINANT_X, unpack(pose.rightArm), idleR)
    drive(rig.left, -DOMINANT_X, unpack(pose.leftArm), idleL)

    applyHand(rig.right, pose.rightHand.fingers, pose.rightHand.thumb, dt)
    applyHand(rig.left, pose.leftHand.fingers, pose.leftHand.thumb, dt)

    // --- life -------------------------------------------------------------
    const L = life.current
    if (clock.current >= L.nextSaccade) {
      L.gaze.yaw = rand(-0.022, 0.022)
      L.gaze.pitch = rand(-0.014, 0.014)
      L.nextSaccade = clock.current + rand(SACCADE_MIN, SACCADE_MAX)
    }
    // Look AT the viewer: aim both eyes at the camera, nudged by the saccade.
    // Micro-saccades move the target point, not each eye independently, so the
    // eyes stay converged.
    const signing = clipId !== 'idle'
    const glance = signing && Math.sin(clock.current * 0.37) > 0.86 ? 1 : 0
    // Aim out from the eyes at their own height, not at the camera: the camera
    // sits below eye level, and aiming there rolls the eyes down far enough to
    // show sclera, which is exactly the look that reads as unsettling.
    rig.face.eyes[0].getWorldPosition(_eyeA)
    rig.face.eyes[1].getWorldPosition(_eyeB)
    _gazeTarget.addVectors(_eyeA, _eyeB).multiplyScalar(0.5)
      .addScaledVector(rig.face.forward, 3)
    _gazeTarget.x += L.gaze.yaw * 3
    _gazeTarget.y += L.gaze.pitch * 3 - glance * 0.35
    applyGazeTarget(rig.face, _gazeTarget, dt)

    // blinkT: >= 0 mid-blink, exactly -1 idle, between the two a double-blink gap.
    if (L.blinkT >= 0) {
      L.blinkT += dt
      if (L.blinkT > BLINK_DUR) {
        if (L.doubleBlink) { L.doubleBlink = false; L.blinkT = -0.07 } else { L.blinkT = -1 }
      }
    } else if (L.blinkT > -1) {
      L.blinkT = Math.min(0, L.blinkT + dt)
    } else if (clock.current >= L.nextBlink) {
      L.blinkT = 0
      L.doubleBlink = Math.random() < 0.12
      L.nextBlink = clock.current + rand(BLINK_MIN, BLINK_MAX)
    }
    const closed = L.blinkT >= 0 ? Math.sin((L.blinkT / BLINK_DUR) * Math.PI) : 0
    // The eyelid bones only half-close this rig's eyes and fight the morph when
    // driven together, so blinking runs purely on the authored ARKit shapes.
    setMorphDirect(rig, 'AK_09_EyeBlinkLeft', closed)
    setMorphDirect(rig, 'AK_10_EyeBlinkRight', closed)
    // Head follows gaze slightly and lags it, which is how real gaze shifts read.
    applyHead(rig.face,
      pose.head[0] + L.gaze.pitch * 0.3 + glance * 0.08,
      pose.head[1] + L.gaze.yaw * 0.35,
      pose.head[2], dt)

    // Non-manual markers, on the model's FACS action units.
    setMorph(rig, 'AU_01_InnerBrowRaiser', pose.browRaise, dt)
    setMorph(rig, 'AU_02_OuterBrowRaiser', pose.browRaise, dt)
    setMorph(rig, 'AU_04_BrowLowerer', pose.browFurrow, dt)
    setMorph(rig, 'AK_25_JawOpen', pose.mouth * 0.32, dt)
  })

  if (!rig) return null
  return <primitive object={rig.root} />
}

export default function Avatar({ clipId, paused = false, speed = 1, compact = false, showGround = true, timeline, onComplete }: AvatarProps) {
  const groundTexture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(22,56,53,0.32)')
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
      aria-label="3D person signing. Motions are composed from published phonological descriptors and are unverified placeholders, not authentic ASL."
    >
      <Canvas
        shadows
        camera={{ position: [0, 0.52, compact ? 3.35 : 3.25], fov: 38 }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        dpr={[1, 1.75]}
        onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}
      >
        <Suspense fallback={null}>
          <hemisphereLight args={['#f2f8f3', '#8d9a91', 0.95]} />
          <directionalLight
            position={[3.2, 5.4, 4.2]}
            intensity={2.0}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0009}
            shadow-normalBias={0.02}
          >
            <orthographicCamera attach="shadow-camera" args={[-3, 3, 3.6, -2.4, 0.5, 16]} />
          </directionalLight>
          <directionalLight position={[-4.2, 2.4, -2.6]} color="#9accb3" intensity={0.9} />
          <directionalLight position={[-1.4, 2.6, -4.4]} color="#ffffff" intensity={1.25} />
          <pointLight position={[0, 1.4, 2.4]} intensity={0.45} distance={7} decay={2} color="#fff4e8" />

          {showGround && (
            <>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]} receiveShadow>
                <circleGeometry args={[2.6, 64]} />
                <meshStandardMaterial color="#dce9da" roughness={1} transparent opacity={0.5} />
              </mesh>
              {groundTexture && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.592, 0.05]}>
                  <planeGeometry args={[3.4, 3.4]} />
                  <meshBasicMaterial map={groundTexture} transparent depthWrite={false} />
                </mesh>
              )}
            </>
          )}

          <Signer clipId={clipId} paused={paused} speed={speed} timeline={timeline} onComplete={onComplete} />
          <OrbitControls
            target={[0, 0.5, 0]}
            enablePan={false}
            minDistance={1.4}
            maxDistance={6}
            minPolarAngle={0.55}
            maxPolarAngle={2}
            enableDamping
          />
        </Suspense>
      </Canvas>
    </div>
  )
}

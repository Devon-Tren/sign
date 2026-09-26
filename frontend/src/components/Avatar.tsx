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
  loadSigner, setMorph,
  applyHead, applyGazeTarget, setMorphDirect,
  type SignerRig,
} from '../signerRig'
import { motionFor, blendPoses, type Pose } from '../clips'
import { applyManualPose, rigSnapshot, type RigSnapshot } from '../rigPose'
import { poseAt } from '../playback'
import type { PlaybackTimeline } from '../types'

type AvatarProps = {
  clipId: string
  paused?: boolean
  speed?: number
  compact?: boolean
  showGround?: boolean
  /** Review-gated playback: a backend-planned timeline overrides clipId. */
  timeline?: PlaybackTimeline
  onComplete?: () => void
  /** Inspector-controlled time; normal playback keeps its own clock. */
  timeMs?: number
  view?: 'default' | 'front' | 'side' | 'hands'
  onRig?: (snapshot: RigSnapshot) => void
}

/** The FBX is parsed once and the result shared by every Avatar instance. */
let signerPromise: Promise<SignerRig> | null = null
function getSigner() {
  if (!signerPromise) signerPromise = loadSigner()
  return signerPromise
}

const _gazeTarget = new THREE.Vector3()
const _eyeA = new THREE.Vector3()
const _eyeB = new THREE.Vector3()

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

function Signer({ clipId, paused, speed, timeline, onComplete, timeMs, onRig }: AvatarProps & { paused: boolean; speed: number }) {
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
  const lastSeek = useRef<number | undefined>(undefined)
  const lastReport = useRef(0)

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
    const at = timeMs === undefined ? elapsed.current : timeMs / 1000

    let pose: Pose
    if (timeline) {
      // A planned timeline sequences its own clips, so the per-clip cross-fade
      // does not apply; poseAt handles the switching.
      const ms = at * 1000
      if (ms >= timeline.duration_ms && !finished.current) {
        finished.current = true
        onComplete?.()
      }
      pose = poseAt(timeline, ms)
    } else {
      shown.current = { clip: clipId, at }
      pose = motionFor(clipId, at)
      if (timeMs === undefined && fade.current < 1 && prev.current) {
        fade.current = Math.min(1, fade.current + dt / FADE_S)
        const outgoing = motionFor(prev.current.clip, prev.current.at)
        const t = fade.current
        pose = blendPoses(outgoing, pose, t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
      }
    }

    if (paused && timeMs !== undefined && lastSeek.current !== timeMs) {
      for (let step = 0; step < 90; step++) {
        rig.root.updateMatrixWorld(true)
        applyManualPose(rig, pose, at, 1 / 60)
      }
    } else applyManualPose(rig, pose, at, dt)
    lastSeek.current = timeMs
    if (onRig && clock.current - lastReport.current > 0.12) {
      lastReport.current = clock.current
      onRig(rigSnapshot(rig))
    }

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
    // Negation in ASL is marked on the HEAD, not the hands: a side-to-side shake
    // co-occurring with the sign. Without it NO and NOT are missing their
    // grammar, however correct the manual articulation is. ~3.1 Hz is inside the
    // range reported for natural negative headshake.
    const shake = pose.headShake > 0
      ? Math.sin(at * Math.PI * 2 * 3.1) * pose.headShake * 0.16
      : 0
    // Head follows gaze slightly and lags it, which is how real gaze shifts read.
    applyHead(rig.face,
      pose.head[0] + L.gaze.pitch * 0.3 + glance * 0.08,
      pose.head[1] + L.gaze.yaw * 0.35 + shake,
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

export default function Avatar({ clipId, paused = false, speed = 1, compact = false, showGround = true, timeline, onComplete,
  timeMs, view = 'default', onRig }: AvatarProps) {
  const cameraPosition: [number, number, number] = view === 'front' ? [0, 0.65, 3.2]
    : view === 'side' ? [-3.2, 0.65, 0.65]
      : view === 'hands' ? [-0.6, 0.95, 1.85]
        : compact ? [-0.90, 0.60, 2.78] : [-0.98, 0.52, 3.02]
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
        key={view}
        shadows
        /**
         * A three-quarter default, not a frontal one. ASL uses movement toward
         * and away from the body, and a dead-on camera flattens exactly that
         * axis; the partial occlusion of a 3/4 view is what lets the eye read
         * hand depth and handshape at the same time. ~18 degrees off axis keeps
         * palm orientation toward the viewer readable. OrbitControls still lets
         * a learner rotate to frontal.
         */
        camera={{
          position: cameraPosition,
          fov: 38,
        }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        dpr={[1, 1.75]}
        onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}
      >
        <Suspense fallback={null}>
          <hemisphereLight args={['#f2f8f3', '#8d9a91', 0.95]} />
          {/*
            The mesh both casts and receives, so the hands already shadow the
            torso - that self-shadow is the strongest available depth cue for
            how far a hand sits from the chest. It was being wasted on a 6x6
            unit shadow frustum covering mostly empty space. Tightening it to
            the figure roughly doubles the effective shadow resolution, which is
            what makes a hand-on-chest contact read as contact.
          */}
          <directionalLight
            position={[3.2, 5.4, 4.2]}
            intensity={2.0}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0006}
            shadow-normalBias={0.014}
          >
            <orthographicCamera attach="shadow-camera" args={[-1.8, 1.8, 2.4, -2.0, 0.5, 12]} />
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

          <Signer clipId={clipId} paused={paused} speed={speed} timeline={timeline} onComplete={onComplete} timeMs={timeMs} onRig={onRig} />
          <OrbitControls
            target={[0, view === 'hands' ? 0.95 : view !== 'default' ? 0.65 : compact ? 0.60 : 0.52, 0]}
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

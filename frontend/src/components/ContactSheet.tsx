/**
 * Catalog contact sheet - the visual half of the motion audit.
 *
 * The catalog could only ever be inspected one sign at a time, which is why two
 * defects shipped unnoticed: three distinct handshapes resolved to the same pose,
 * and 19 of the 26 fingerspelled letters shared a shape with another letter.
 * Both are obvious the moment the whole set is on one screen and invisible any
 * other way.
 *
 * Every sign is rendered on the real rig, settled to its hold frame, and
 * captured. The numeric half of the audit runs alongside it in ../audit, so a
 * lost distinction is a failing number as well as a picture.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AlertTriangle, Camera, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import {
  applyGazeTarget, applyHand, applySpine, loadSigner, setMorph, setMorphDirect,
  setHandOrientation, smoothTarget, solveArmIK, type ArmChain, type SignerRig,
} from '../signerRig'
import {
  allSignIds, breathAt, clipLengthMs, idlePose, motionFor, signParams,
  type Pose, type Vec3,
} from '../clips'
import { auditReport, type AuditReport } from '../audit'

const DOMINANT_X = -1
/** Frames to let the rig's critically-damped followers settle on the hold pose. */
const SETTLE_FRAMES = 22
const STEP = 1 / 60

type Shot = { id: string; url: string }

const _t = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()
const _shL = new THREE.Vector3()
const _shR = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _gaze = new THREE.Vector3()
const _eyeA = new THREE.Vector3()
const _eyeB = new THREE.Vector3()

function toWorld(rig: SignerRig, n: Vec3, out: THREE.Vector3, contact = false) {
  rig.left.upper.getWorldPosition(_shL)
  rig.right.upper.getWorldPosition(_shR)
  _mid.addVectors(_shL, _shR).multiplyScalar(0.5)
  const reach = rig.right.upperLen + rig.right.foreLen
  const center = 1 - THREE.MathUtils.clamp(Math.abs(n[0]) / 0.58, 0, 1)
  const band = 1 - THREE.MathUtils.clamp(Math.abs(n[1] + 0.22) / 0.46, 0, 1)
  const minForward = contact ? 0.15 : 0.22 + center * band * 0.13
  return out.set(
    _mid.x + n[0] * DOMINANT_X * reach,
    _mid.y + n[1] * reach,
    _mid.z + Math.max(n[2], minForward) * reach,
  )
}
const toDir = (d: Vec3, out: THREE.Vector3) => out.set(d[0] * DOMINANT_X, d[1], d[2]).normalize()

/** Drive the rig to one pose and hold it there until the dampers settle. */
function applyPose(rig: SignerRig, pose: Pose, at: number, dt: number) {
  applySpine(rig.face, pose.torso, breathAt(at) * 0.018, dt)
  const idle = idlePose(at)
  const drive = (arm: ArmChain, sign: number, target: Pose['rightArm'], fallback: NonNullable<Pose['rightArm']>) => {
    const resolved = target ?? fallback
    toWorld(rig, resolved.target, _t, resolved.contact === true)
    const pole = resolved.elbow ? toDir(resolved.elbow, _q) : undefined
    solveArmIK(arm, smoothTarget(arm, _t, dt), sign, dt, pole)
    setHandOrientation(arm, toDir(resolved.palm, _p), toDir(resolved.point, _q), dt, resolved.wristMax)
  }
  drive(rig.right, DOMINANT_X, pose.rightArm, idle.rightArm!)
  drive(rig.left, -DOMINANT_X, pose.leftArm, idle.leftArm!)
  applyHand(rig.right, pose.rightHand.fingers, pose.rightHand.thumb, dt)
  applyHand(rig.left, pose.leftHand.fingers, pose.leftHand.thumb, dt)

  rig.face.eyes[0].getWorldPosition(_eyeA)
  rig.face.eyes[1].getWorldPosition(_eyeB)
  _gaze.addVectors(_eyeA, _eyeB).multiplyScalar(0.5).addScaledVector(rig.face.forward, 3)
  applyGazeTarget(rig.face, _gaze, dt)
  setMorphDirect(rig, 'AK_09_EyeBlinkLeft', 0)
  setMorphDirect(rig, 'AK_10_EyeBlinkRight', 0)
  setMorph(rig, 'AU_01_InnerBrowRaiser', pose.browRaise, dt)
  setMorph(rig, 'AU_02_OuterBrowRaiser', pose.browRaise, dt)
  setMorph(rig, 'AU_04_BrowLowerer', pose.browFurrow, dt)
  setMorph(rig, 'AK_25_JawOpen', pose.mouth * 0.32, dt)
}

/**
 * Steps through the sign list, settling and capturing each one. Capture happens
 * inside the frame callback with `preserveDrawingBuffer`, because the drawing
 * buffer is cleared before the next paint otherwise.
 */
function Capturer({ ids, onShot, onDone }: {
  ids: readonly string[]
  onShot: (shot: Shot) => void
  onDone: () => void
}) {
  const { gl, scene, camera } = useThree()
  const [rig, setRig] = useState<SignerRig | null>(null)
  const index = useRef(0)
  const frame = useRef(0)

  useEffect(() => {
    let alive = true
    loadSigner().then((r) => { if (alive) setRig(r) }).catch((e) => console.error(e))
    return () => { alive = false }
  }, [])

  useFrame(() => {
    if (!rig || index.current >= ids.length) return
    const id = ids[index.current]
    // Hold frame: past the stroke, before the release. This is the part of a
    // sign the eye actually reads, so it is what the sheet should show.
    const holdSeconds = (clipLengthMs(id, 'isolated') * 0.62) / 1000
    applyPose(rig, motionFor(id, holdSeconds, { mode: 'isolated' }), holdSeconds, STEP)
    frame.current += 1
    if (frame.current < SETTLE_FRAMES) return

    gl.render(scene, camera)
    onShot({ id, url: gl.domElement.toDataURL('image/webp', 0.82) })
    frame.current = 0
    index.current += 1
    if (index.current >= ids.length) onDone()
  })

  return rig ? <primitive object={rig.root} /> : null
}

function Badge({ id }: { id: string }) {
  const p = signParams(id)
  if (!p) return <span className="sheet-badge sheet-badge-none">no descriptors</span>
  if (p.app_authored) return <span className="sheet-badge sheet-badge-none">app-authored</span>
  if (p.fidelity === 'approximate') {
    return <span className="sheet-badge sheet-badge-warn" title={p.mapping_note ?? ''}>approximate</span>
  }
  const morphemes = p.morphemes?.length ?? 1
  return (
    <span className="sheet-badge sheet-badge-ok">
      ASL-LEX{morphemes > 1 ? ` · ${morphemes} morphemes` : ''}
    </span>
  )
}

export default function ContactSheet() {
  const ids = useMemo(() => allSignIds(), [])
  const [shots, setShots] = useState<Shot[]>([])
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [filter, setFilter] = useState<'all' | 'exact' | 'approximate' | 'authored'>('all')

  useEffect(() => { setReport(auditReport()) }, [])

  const onShot = useCallback((shot: Shot) => setShots((s) => [...s, shot]), [])
  const onDone = useCallback(() => setRunning(false), [])
  const start = () => { setShots([]); setRunning(true) }

  const visible = shots.filter(({ id }) => {
    if (filter === 'all') return true
    const p = signParams(id)
    if (!p) return filter === 'authored'
    if (filter === 'authored') return !!p.app_authored
    if (filter === 'approximate') return p.fidelity === 'approximate'
    return p.fidelity === 'exact' && !p.app_authored
  })

  const collisions = (report?.handshapeCollisions.length ?? 0)
    + (report?.fingerspellCollisions.length ?? 0)

  return (
    <div className="sheet">
      <div className="sheet-note">
        <Info size={15} />
        <span>
          Every motion in the catalog, rendered on the real rig at its hold frame.
          These are procedural approximations composed from published phonological
          descriptors, <strong>not validated ASL</strong>, and none of them has a
          signer-review record.
        </span>
      </div>

      {report && (
        <div className="sheet-report">
          <div className="sheet-stats">
            <div><strong>{report.signs}</strong><span>motions</span></div>
            <div><strong>{report.withDescriptors}</strong><span>ASL-LEX backed</span></div>
            <div><strong>{report.approximate}</strong><span>approximate</span></div>
            <div><strong>{report.appAuthored}</strong><span>app-authored</span></div>
            <div><strong>{report.multiMorpheme}</strong><span>multi-morpheme</span></div>
            <div><strong>{report.handshapesCovered}</strong><span>handshapes</span></div>
          </div>
          <div className={collisions ? 'sheet-verdict bad' : 'sheet-verdict good'}>
            {collisions
              ? <><AlertTriangle size={16} /> {collisions} pose collision(s): distinct signs render identically.</>
              : <><CheckCircle2 size={16} /> No pose collisions. Every handshape and every letter is distinct.</>}
          </div>
          {report.handshapeCollisions.map((c) => (
            <div key={`${c.a}-${c.b}`} className="sheet-collision">
              {c.a} = {c.b} — max joint delta {c.distance.toFixed(4)} rad
            </div>
          ))}
          {report.fingerspellCollisions.map((c) => (
            <div key={`${c.a}-${c.b}`} className="sheet-collision">
              letter {c.a} = letter {c.b} — combined delta {c.distance.toFixed(4)}
            </div>
          ))}
        </div>
      )}

      <div className="sheet-controls">
        <button onClick={start} disabled={running}>
          {running ? <RefreshCw size={16} className="spin" /> : <Camera size={16} />}
          {running ? `Capturing ${shots.length}/${ids.length}` : 'Capture contact sheet'}
        </button>
        {(['all', 'exact', 'approximate', 'authored'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {/* One offscreen canvas does all the work; 103 live canvases would not run. */}
      <div className="sheet-stage" aria-hidden="true">
        <Canvas
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true,
                toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
          camera={{ position: [-0.98, 0.52, 3.02], fov: 38 }}
          dpr={1}
          frameloop={running ? 'always' : 'never'}
        >
          <Suspense fallback={null}>
            <hemisphereLight args={['#f2f8f3', '#8d9a91', 0.95]} />
            <directionalLight position={[3.2, 5.4, 4.2]} intensity={2.0} />
            <directionalLight position={[-1.4, 2.6, -4.4]} intensity={1.25} />
            {running && <Capturer ids={ids} onShot={onShot} onDone={onDone} />}
          </Suspense>
        </Canvas>
      </div>

      <div className="sheet-grid">
        {visible.map(({ id, url }) => (
          <figure key={id} className="sheet-cell">
            <img src={url} alt={`Rendered hold frame for ${id}`} loading="lazy" />
            <figcaption>
              <code>{id}</code>
              <Badge id={id} />
            </figcaption>
          </figure>
        ))}
      </div>

      {!shots.length && !running && (
        <p className="sheet-empty">
          Capture renders all {ids.length} motions one at a time on the shared rig
          and settles each for {SETTLE_FRAMES} frames before the shot, so the
          poses are the ones playback actually produces.
        </p>
      )}
    </div>
  )
}

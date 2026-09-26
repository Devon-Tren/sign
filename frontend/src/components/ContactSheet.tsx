/**
 * Catalog contact sheet - the visual half of the motion audit.
 *
 * The catalog could only ever be inspected one sign at a time, which is why two
 * defects shipped unnoticed: three distinct handshapes resolved to the same pose,
 * and 19 of the 26 fingerspelled letters shared a shape with another letter.
 * Both are obvious the moment the whole set is on one screen and invisible any
 * other way.
 *
 * Every sign is rendered on the real rig at start, stroke and hold, and
 * captured. The numeric half of the audit runs alongside it in ../audit, so a
 * lost distinction is a failing number as well as a picture.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AlertTriangle, Camera, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import {
  applyGazeTarget, applyHead, loadSigner, setMorph, setMorphDirect,
  type SignerRig,
} from '../signerRig'
import {
  allSignIds, clipLengthMs, motionFor, signParams,
  type Pose,
} from '../clips'
import { auditReport, priorUsage } from '../audit'
import { phonoPriorFor } from '../phono'
import { applyManualPose } from '../rigPose'

/** Frames to let the rig's critically-damped followers settle on the hold pose. */
const SETTLE_FRAMES = 90
const STEP = 1 / 60

const PHASES = [{ name: 'start', fraction: 0.15 }, { name: 'stroke', fraction: 0.35 },
  { name: 'hold', fraction: 0.62 }] as const
type Shot = { id: string; phase: string; url: string }
type Scope = 'priority' | 'priors' | 'static' | 'all'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const _gaze = new THREE.Vector3()
const _eyeA = new THREE.Vector3()
const _eyeB = new THREE.Vector3()

/** Drive the rig to one pose and hold it there until the dampers settle. */
function applyPose(rig: SignerRig, pose: Pose, at: number, dt: number) {
  applyManualPose(rig, pose, at, dt)

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
  const shake = Math.sin(at * Math.PI * 2 * 3.1) * pose.headShake * 0.16
  applyHead(rig.face, pose.head[0], pose.head[1] + shake, pose.head[2], dt)
}

/**
 * Steps through the sign list, settling and capturing each one. Capture happens
 * inside the frame callback with `preserveDrawingBuffer`, because the drawing
 * buffer is cleared before the next paint otherwise.
 */
function Capturer({ ids, usePriors, onShot, onDone, onError }: {
  ids: readonly string[]
  usePriors: boolean
  onShot: (shot: Shot) => void
  onDone: () => void
  onError: (message: string) => void
}) {
  const { gl, scene, camera } = useThree()
  const [rig, setRig] = useState<SignerRig | null>(null)
  const index = useRef(0)

  useEffect(() => {
    let alive = true
    loadSigner().then((r) => { if (alive) setRig(r) })
      .catch((e) => { if (alive) onError(`Avatar could not load: ${String(e)}`) })
    return () => { alive = false }
  }, [onError])

  useFrame(() => {
    if (!rig || index.current >= ids.length * PHASES.length) return
    const id = ids[Math.floor(index.current / PHASES.length)]
    const phase = PHASES[index.current % PHASES.length]
    // Hold frame: past the stroke, before the release. This is the part of a
    // sign the eye actually reads, so it is what the sheet should show.
    const holdSeconds = (clipLengthMs(id, 'isolated') * phase.fraction) / 1000
    const pose = motionFor(id, holdSeconds, { mode: 'isolated', usePhonoPriors: usePriors })
    // Advance the followers without drawing intermediate frames. A short
    // 22-frame warmup left the first face-level sign halfway out of the bind
    // pose. Fixed simulation steps make capture independent of GPU frame rate.
    for (let step = 0; step < SETTLE_FRAMES; step++) {
      rig.root.updateMatrixWorld(true)
      applyPose(rig, pose, holdSeconds, STEP)
    }

    gl.render(scene, camera)
    onShot({ id, phase: phase.name, url: gl.domElement.toDataURL('image/webp', 0.82) })
    index.current += 1
    if (index.current >= ids.length * PHASES.length) onDone()
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
  const report = useMemo(() => auditReport(), [])
  const [scope, setScope] = useState<Scope>('priority')
  const [usePriors, setUsePriors] = useState(true)
  const [error, setError] = useState('')
  const ids = useMemo(() => {
    const all = allSignIds()
    if (scope === 'priority') return all.filter(id => signParams(id)?.fidelity === 'exact')
      .sort((a, b) => (signParams(b)?.SignFrequency ?? 0) - (signParams(a)?.SignFrequency ?? 0)
        || a.localeCompare(b)).slice(0, 100)
    if (scope === 'priors') return all.filter(id => {
      const usage = priorUsage(id)
      return usage.orientation || usage.movement
    })
    if (scope === 'static') return all.filter(id => report.issues.some(i => i.sign === id && i.kind === 'static-path'))
    return all
  }, [scope, report])
  const [shots, setShots] = useState<Shot[]>([])
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState<'all' | 'exact' | 'approximate' | 'authored'>('all')

  const onShot = useCallback((shot: Shot) => setShots((s) => [...s, shot]), [])
  const onDone = useCallback(() => setRunning(false), [])
  const onError = useCallback((message: string) => { setError(message); setRunning(false) }, [])
  const start = () => { setShots([]); setError(''); setRunning(true) }

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
  const visibleIds = [...new Set(visible.map(s => s.id))]
  const exportSheet = () => {
    const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
    const html = visibleIds.map(id => `<article><h2>${escape(id)}</h2>`
      + `<p>Frequency ${signParams(id)?.SignFrequency ?? 'unknown'} · Pending signer review</p>`
      + `<div>${visible.filter(s => s.id === id).map(s => `<figure><img src="${s.url}" alt="${escape(id)} ${s.phase}"><figcaption>${s.phase}</figcaption></figure>`).join('')}</div>`
      + `<p>${escape(JSON.stringify(priorUsage(id)))}</p></article>`).join('')
    download(`sign-contact-sheet-${scope}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>SIGN motion review</title>
      <style>body{font:14px system-ui;margin:24px;background:#eef2ef}main{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}article{background:white;padding:16px;break-inside:avoid}article>div{display:flex}figure{margin:0;flex:1}img{width:100%}h2{margin:0}figcaption{text-align:center}</style>
      <h1>SIGN motion review · ${visibleIds.length} signs</h1><p>ASL-Phono ${usePriors ? 'enabled' : 'disabled'}. Procedural candidates; no signer approval implied.</p>
      <p>Descriptors and frequencies: <a href="https://asl-lex.org/">ASL-LEX 2.0</a>, Sehyr, Caselli, Cohen-Goldberg and Emmorey (2021), <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>.
      Orientation/direction estimates: <a href="https://doi.org/10.5281/zenodo.5484145">ASL-Phono</a>, de Amorim and Zanchettin (2021), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Subset selected, frame votes aggregated, directions mapped to a procedural avatar.
      Avatar: Microsoft Rocketbox, MIT.</p><main>${html}</main></html>`, 'text/html')
  }

  return (
    <div className="sheet">
      <div className="sheet-note">
        <Info size={15} />
        <span>
          Compare start, stroke and hold poses on the real rig, beginning with the 100 most frequent signs.
          These are procedural approximations composed from published phonological
          descriptors, <strong>not validated ASL</strong>, and none of them has a
          signer-review record.
          {' '}Orientation estimates: <a href="https://doi.org/10.5281/zenodo.5484145" target="_blank" rel="noreferrer">ASL-Phono</a>
          {' '}by de Amorim and Zanchettin, CC BY 4.0; aggregated and mapped to this rig.
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
            <div><strong>{report.phonoOrientationApplied}</strong><span>orientation priors used</span></div>
            <div><strong>{report.staticPaths}</strong><span>static · needs review</span></div>
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
        <select aria-label="Capture scope" value={scope} disabled={running}
          onChange={e => { setScope(e.target.value as Scope); setShots([]) }}>
          <option value="priority">Top 100 by frequency</option>
          <option value="priors">Signs changed by ASL-Phono</option>
          <option value="static">Static signs needing review</option>
          <option value="all">Entire catalog</option>
        </select>
        <label><input type="checkbox" checked={usePriors} disabled={running}
          onChange={e => { setUsePriors(e.target.checked); setShots([]) }} /> ASL-Phono priors</label>
        <button onClick={start} disabled={running}>
          {running ? <RefreshCw size={16} className="spin" /> : <Camera size={16} />}
          {running ? `Capturing ${shots.length}/${ids.length * PHASES.length}` : 'Capture contact sheet'}
        </button>
        {running && <button onClick={() => setRunning(false)}>Stop capture</button>}
        <button onClick={exportSheet} disabled={!shots.length || running}>Download sheet</button>
        <button onClick={() => download('sign-motion-audit.json', JSON.stringify(report, null, 2), 'application/json')}>Download audit</button>
        {(['all', 'exact', 'approximate', 'authored'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}

      {/* One canvas does all the work instead of allocating one per sign. */}
      <div className="sheet-stage" aria-hidden="true">
        <Canvas
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true,
                toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
          camera={{ position: [-1.0, 0.68, 3.25], fov: 42 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.68, 0)}
          dpr={1}
          frameloop={running ? 'always' : 'never'}
        >
          <Suspense fallback={null}>
            <hemisphereLight args={['#f2f8f3', '#8d9a91', 0.95]} />
            <directionalLight position={[3.2, 5.4, 4.2]} intensity={2.0} />
            <directionalLight position={[-1.4, 2.6, -4.4]} intensity={1.25} />
            {running && <Capturer ids={ids} usePriors={usePriors} onShot={onShot} onDone={onDone} onError={onError} />}
          </Suspense>
        </Canvas>
      </div>

      <div className="sheet-grid">
        {visibleIds.map(id => (
          <figure key={id} className="sheet-cell">
            <div className="sheet-phases">{visible.filter(s => s.id === id).map(s => <div key={s.phase}>
              <img src={s.url} alt={`${id}: ${s.phase}`} loading="lazy" /><small>{s.phase}</small>
            </div>)}</div>
            <figcaption>
              <code>{id}</code>
              <Badge id={id} />
              <span>Frequency: {signParams(id)?.SignFrequency?.toFixed(2) ?? 'unknown'}</span>
              <span>{usePriors && priorUsage(id).orientation ? 'Palm: ASL-Phono estimate' : 'Palm: authored / derived'}</span>
              {phonoPriorFor(id)?.orientation_dh && <span>
                Frame agreement: {Math.round(phonoPriorFor(id)!.orientation_dh!.consensus * 100)}%
                {' · '}{phonoPriorFor(id)!.sample_count} source samples
              </span>}
              <a href="https://dai.cs.rutgers.edu/dai/s/signbank" target="_blank" rel="noreferrer">Reference: search {signParams(id)?.asl_lex_entry ?? id}</a>
            </figcaption>
          </figure>
        ))}
      </div>

      {!shots.length && !running && (
        <p className="sheet-empty">
          Capture renders {ids.length} motions at three points in time on the shared rig
          and settles each for {SETTLE_FRAMES} frames before the shot, so the
          poses are the ones playback actually produces.
        </p>
      )}
    </div>
  )
}

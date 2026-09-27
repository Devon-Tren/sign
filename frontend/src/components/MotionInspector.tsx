import { useCallback, useEffect, useMemo, useState } from 'react'
import Avatar from './Avatar'
import { planASL } from '../api'
import { clipLengthMs, motionFor, signParams } from '../clips'
import { playbackPlan, poseAt } from '../playback'
import { offlinePlan } from '../offlinePlan'
import { authoredClipFor } from '../authored'
import { phonoPriorFor } from '../phono'
import type { PlanResult, PlaybackTimeline } from '../types'
import type { RigSnapshot } from '../rigPose'

export default function MotionInspector() {
  const [text, setText] = useState('Hello. Good morning.')
  const [timeline, setTimeline] = useState<PlaybackTimeline>(() => playbackPlan(offlinePlan('Hello. Good morning.')!.timeline))
  const [source, setSource] = useState('Local catalog')
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0.5)
  const [view, setView] = useState<'front' | 'side' | 'hands'>('front')
  const [rig, setRig] = useState<RigSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastPlan, setLastPlan] = useState<PlanResult | null>(null)
  const onRig = useCallback((value: RigSnapshot) => setRig(value), [])
  const active = timeline.clips.find(c => time >= c.start_ms && time < c.end_ms)
  const clipId = active?.clip_id ?? 'idle'
  const authored = authoredClipFor(clipId)
  const local = active ? time - active.start_ms : 0
  const duration = active ? active.end_ms - active.start_ms : clipLengthMs('idle')
  const onset = Math.min(220, duration * 0.2), release = Math.min(200, duration * 0.2)
  const phase = Math.max(0, Math.min(1, (local - onset) / (duration - onset - release)))
  const phaseName = authored?.keyframes.slice().reverse().find(f => f.at <= phase)?.phase
    ?? (clipId === 'idle' ? 'rest' : 'procedural stroke')
  const pose = useMemo(() => poseAt(timeline, time), [timeline, time])
  // Between clips the played plan is a scheduled transition, not rest.
  const upcoming = timeline.clips.find(c => c.start_ms > time)
  const transitionLabel = time >= timeline.duration_ms - 1 || (!upcoming && time > 0)
    ? 'REST · lead-out' : upcoming ? `→ ${upcoming.sign_id} · transition` : 'REST'

  useEffect(() => {
    if (!playing) return
    let frame = 0, last = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(70, now - last) * speed
      last = now
      setTime(t => Math.min(timeline.duration_ms - 1, t + delta))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, timeline])
  useEffect(() => { if (time >= timeline.duration_ms - 1) setPlaying(false) }, [time, timeline])

  async function inspect() {
    setPlaying(false); setBusy(true)
    try {
      const result = await planASL(text, [])
      setLastPlan(result)
      const next = result.rehearsal ?? result.playback
      setSource(`Backend · ${result.mode}${next ? '' : ' · no playable rehearsal'}`)
      if (next) { setTimeline(playbackPlan(next)); setTime(0) }
    } catch {
      setLastPlan(null)
      const next = offlinePlan(text)
      if (next) { setTimeline(playbackPlan(next.timeline)); setSource('Local catalog · backend unavailable'); setTime(0) }
      else setSource('No playable signs found')
    } finally { setBusy(false) }
  }
  const move = (delta: number) => { setPlaying(false); setTime(t => Math.max(0, Math.min(timeline.duration_ms - 1, t + delta))) }
  const direct = motionFor(clipId, local / 1000, { mode: 'continuous', durationMs: duration })

  return <section className="motion-inspector">
    <div><h2>Motion inspector</h2><p>Inspect the selected signs, motion phases and solved hand positions. Authored motions remain candidates for signer review.</p></div>
    <form onSubmit={e => { e.preventDefault(); void inspect() }}>
      <label htmlFor="inspect-text">English input</label>
      <input id="inspect-text" value={text} onChange={e => setText(e.target.value)} maxLength={3000}/>
      <button disabled={busy || !text.trim()}>{busy ? 'Planning…' : 'Inspect sentence'}</button>
    </form>
    <p>{source} · {timeline.clips.map(c => c.sign_id).join(' → ')}</p>
    {lastPlan && <div className="plan-status" aria-live="polite">
      <strong>Planner mode: {lastPlan.mode}</strong>
      <span>{lastPlan.validation?.executable ? 'Playable plan' : 'Playback blocked by validation'}</span>
      {!!lastPlan.unresolved.length && <span>Unresolved: {lastPlan.unresolved.join(', ')}</span>}
      {!!lastPlan.validation?.issues.length && <span>Issues: {lastPlan.validation.issues.join('; ')}</span>}
    </div>}
    <div className="inspector-layout">
      <div>
        <div className="inspector-avatar"><Avatar clipId="inspection" timeline={timeline} paused={!playing}
          timeMs={time} view={view} onRig={onRig} showGround={false}/></div>
        <div className="sheet-controls">{(['front', 'side', 'hands'] as const).map(v =>
          <button className={view === v ? 'active' : ''} key={v} onClick={() => setView(v)}>{v === 'hands' ? 'Hand close-up' : v}</button>)}</div>
      </div>
      <div className="inspector-detail">
        <strong data-testid="active-motion">{active ? `${active.sign_id} · ${phaseName}` : transitionLabel}</strong>
        <p>{authored ? `Authored phases: ${authored.variant}` : 'Descriptor-generated motion'}</p>
        {authored?.references.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">Sign reference</a>)}
        <div className="sheet-controls">
          <button onClick={() => { if (time >= timeline.duration_ms - 1) setTime(0); setPlaying(p => !p) }}>{playing ? 'Pause' : 'Play'}</button>
          <button onClick={() => move(-1000 / 30)}>Previous frame</button>
          <button onClick={() => move(1000 / 30)}>Next frame</button>
          <select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            {[0.25, 0.5, 1].map(s => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
        <label htmlFor="inspect-time">{Math.round(time)} / {timeline.duration_ms} ms</label>
        <input id="inspect-time" aria-label="Motion time" type="range" min={0} max={timeline.duration_ms - 1}
          step={1} value={Math.round(time)} onChange={e => { setPlaying(false); setTime(Number(e.target.value)) }}/>
        <div className="inspector-boundaries">{timeline.clips.map(c => <button key={c.anchor} onClick={() => {
          setPlaying(false); setTime(c.start_ms + Math.min(250, (c.end_ms - c.start_ms) * 0.25))
        }}>{c.sign_id}<small>{c.start_ms}–{c.end_ms} ms</small></button>)}</div>
        {authored && <div className="inspector-boundaries">{authored.keyframes.map(f => <button key={f.at} onClick={() => {
          setPlaying(false); setTime(active!.start_ms + onset + f.at * (duration - onset - release))
        }}>{f.phase}</button>)}</div>}
        <details open><summary>Generated targets and contact</summary><pre data-testid="requested-pose">{JSON.stringify({
          right: pose.rightArm, left: pose.leftArm,
        }, null, 2)}</pre></details>
        <details><summary>Actual solved bones</summary><pre data-testid="solved-rig">{JSON.stringify(rig, null, 2)}</pre></details>
        <details><summary>Descriptors, source evidence and timing</summary><pre>{JSON.stringify({
          clip: active, descriptors: signParams(clipId), authored, phono: phonoPriorFor(clipId),
          unblended: { right: direct.rightArm, left: direct.leftArm },
        }, null, 2)}</pre></details>
      </div>
    </div>
  </section>
}

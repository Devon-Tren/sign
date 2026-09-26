import { augmentFor, signParams } from '../clips'
import { curated, curatedSign } from '../motion/curated'
import { defaultPhases, phaseAt, proceduralPhase } from '../motion/phases'
import { clipSampleMs } from '../playback'
import { resolveSign } from '../motion/resolver'
import { transitionsFor } from '../motion/transitions'
import { wristQuaternion } from '../motion/orientation'
import { relationFor } from '../anchors'
import type { MotionSnapshot } from '../motion/types'
import type { PlaybackTimeline } from '../types'

export type CameraPreset = 'default' | 'front' | 'side' | 'hands'
type Props = {
  timeline: PlaybackTimeline; transcript?: string; snapshot: MotionSnapshot | null
  paused: boolean; speed: number; onPause: () => void; onSeek: (ms: number) => void
  onSpeed: (speed: number) => void; onCamera: (preset: CameraPreset) => void
  onReplay: (ms: number) => void
  isolated?: boolean
}
export default function MotionInspector({ timeline, transcript, snapshot, paused, speed, onPause, onSeek, onSpeed, onCamera, onReplay, isolated }: Props) {
  const ms = snapshot?.timeMs ?? 0
  const index = Math.max(0, timeline.clips.findIndex(c => ms >= c.start_ms && ms < c.end_ms))
  const clip = timeline.clips[index]
  if (!clip) return <aside className="motion-inspector">No motion selected.</aside>
  const duration = clip.end_ms - clip.start_ms, local = ms - clip.start_ms
  const params = signParams(clip.clip_id), augment = augmentFor(clip.clip_id)
  const phrase = timeline.curated_phrase ? curated.phrases[timeline.curated_phrase] : undefined
  const definition = phrase ?? curatedSign(clip.clip_id)
  const transition = !phrase ? transitionsFor(timeline, speed)[index] : undefined
  const sampleMs = isolated ? local : clipSampleMs(timeline,index,local,speed)
  const phase = transition && ms >= transition.start ? 'transition' : definition
    ? phaseAt(phrase ? ms / timeline.duration_ms : sampleMs / duration, definition.phases ?? defaultPhases(duration))
    : proceduralPhase(sampleMs,duration,params?.morphemes?.length || 1,augment.phases)
  const pose = snapshot?.pose
  const inspectHand = (side: 'right' | 'left') => {
    const arm = pose?.[`${side}Arm`]
    return arm ? { target: arm.target, palm: arm.palm, fingerDirection: arm.point,
      requestedWristQuaternion: wristQuaternion(arm.palm, arm.point).toArray(),
      actualWristWorldQuaternion: snapshot?.wristWorld[side], actualHandWorld: snapshot?.handWorld[side],
      contact: arm.contact, elbowHint: arm.elbow, joints: pose?.[`${side}Hand`] } : null
  }
  const diagnostics = {
    source: phrase ? 'curated-phrase' : resolveSign(clip.clip_id).source,
    provenance: definition?.provenance ?? 'Procedural descriptors / fingerspelling; unreviewed',
    signType: params?.SignType, twoHanded: params ? params.SignType !== 'OneHanded' : false,
    handshape: params?.Handshape, location: [params?.MajorLocation, params?.MinorLocation],
    movement: augment.primitive ?? params?.Movement, repetition: augment.repeat_count ?? params?.RepeatedMovement,
    contact: params?.Contact, relationship: definition?.relationship ?? augment.relationship ?? { signType: params?.SignType, surface: params?.MinorLocation, relation: relationFor(params?.MinorLocation,augment.hand_relation) },
    right: inspectHand('right'), left: inspectHand('left'),
    activeNonmanuals: timeline.nonmanuals.filter(s => ms >= s.start_ms && ms < s.end_ms),
    phraseNonmanuals: definition?.nonmanuals, appliedNonmanuals: pose && { ...pose.nonmanual, browRaise: pose.browRaise, browFurrow: pose.browFurrow, mouth: pose.mouth, head: pose.head, headShake: pose.headShake },
    unavailableMorphs: snapshot?.missingMorphs,
  }
  return <aside className="motion-inspector" aria-label="Experimental motion inspector">
    <strong>Experimental motion inspector · unreviewed</strong>
    <p>{transcript || 'Isolated reference motion'}</p>
    <p className="motion-sequence">{timeline.clips.map((c,i)=><button key={c.anchor} aria-current={i===index?'step':undefined} onClick={()=>onSeek(c.start_ms)}>{c.sign_id}</button>)}</p>
    <p>{timeline.clips[index-1]?.sign_id ?? 'Start'} → <b>{clip.sign_id}</b> → {timeline.clips[index+1]?.sign_id ?? 'End'}</p>
    <p>{diagnostics.source} · {phase} · {Math.round(ms)} / {Math.round(timeline.duration_ms)} ms · sign {Math.round(duration)} ms</p>
    <div className="motion-buttons">
      <button onClick={onPause}>{paused?'Play':'Pause'}</button>
      <button onClick={()=>onSeek(timeline.clips[Math.max(0,index-1)].start_ms)}>Previous sign</button>
      <button onClick={()=>onSeek(timeline.clips[Math.min(timeline.clips.length-1,index+1)].start_ms)}>Next sign</button>
      <button onClick={()=>onSeek(ms-1000/30)}>−1 frame</button>
      <button onClick={()=>onSeek(ms+1000/30)}>+1 frame</button>
      <button onClick={()=>onReplay(clip.start_ms)}>Replay sign</button>
      <label>Speed <select aria-label="Inspector speed" value={speed} onChange={e=>onSpeed(Number(e.target.value))}>{[.25,.5,1].map(s=><option key={s} value={s}>{s}×</option>)}</select></label>
      <label>Camera <select aria-label="Inspector camera" onChange={e=>onCamera(e.target.value as CameraPreset)}><option value="default">Three-quarter</option><option value="front">Front</option><option value="side">Side</option><option value="hands">Hands</option></select></label>
    </div>
    <input aria-label="Motion time" type="range" min={0} max={Math.max(0,timeline.duration_ms-1)} step={1} value={Math.min(ms,timeline.duration_ms-1)} onChange={e=>onSeek(Number(e.target.value))}/>
    <details><summary>Pose, orientation, IK and nonmanual diagnostics</summary><pre>{JSON.stringify(diagnostics,null,2)}</pre></details>
    <details><summary>Raw phonology and authored overrides</summary><pre>{JSON.stringify({params,augment,curated:definition},null,2)}</pre></details>
    <small>Targets use normalized body coordinates. Actual hand measurements use world coordinates. Requested orientation precedes rig limits and smoothing. Frame step = 1/30 s.</small>
  </aside>
}

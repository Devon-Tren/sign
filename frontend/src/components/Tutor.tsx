import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, CameraOff, Check, CheckCircle2, CircleAlert, Eye, GraduationCap, Info, LockKeyhole, ScanLine, Sparkles, Target } from 'lucide-react'
import type { HandLandmarker } from '@mediapipe/tasks-vision'
type NormalizedLandmark = {x:number; y:number; z:number}
import Avatar from './Avatar'
import { generateFeedback } from '../api'
import { DRILLS } from '../data'
import type { Drill } from '../types'

const CONNECTIONS:[[number,number],...Array<[number,number]>]=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]]
const NAMES=['index','middle','ring','little']
const TARGETS:Record<Drill['target'],number[][]>={open:[[1,1,1,1]],fist:[[0,0,0,0]],index:[[1,0,0,0]],'two-open':[[1,1,1,1],[1,1,1,1]]}

type Assessment={score:number;observed:string;expected:string;tip:string;hands:number;fingerStates:number[][]}
function angle(a:NormalizedLandmark,b:NormalizedLandmark,c:NormalizedLandmark){
  const u=[a.x-b.x,a.y-b.y,a.z-b.z],v=[c.x-b.x,c.y-b.y,c.z-b.z]
  const dot=u.reduce((acc,x,i)=>acc+x*v[i],0)
  const len=(p:number[])=>Math.sqrt(p.reduce((s,x)=>s+x*x,0))
  return Math.acos(Math.max(-1,Math.min(1,dot/(len(u)*len(v)+1e-9))))*180/Math.PI
}
export function fingerState(points:NormalizedLandmark[]):number[]{
  return [[5,6,8],[9,10,12],[13,14,16],[17,18,20]].map(([m,p,t])=>angle(points[m],points[p],points[t])>145?1:0)
}
export function assessHands(landmarks:NormalizedLandmark[][], target:Drill['target']):Assessment {
  const goals=TARGETS[target]
  const states=landmarks.map(fingerState)
  if(!states.length)return {score:0,observed:'No hands detected',expected:goals.length===2?'Both palms open':'One hand in frame',tip:'Bring your hands into the webcam frame.',hands:0,fingerStates:[]}
  const handScores=states.map(state=>goals[0].reduce((s,expect,i)=>s+(state[i]===expect?1:0),0)/4)
  let score:number
  if(goals.length===2){
    const best=handScores.sort((a,b)=>b-a)
    score=(best[0]+(best[1]??0))/2*100
  } else score=Math.max(...handScores)*100
  const bestState=states[states.findIndex(state=>state.reduce((n,x,i)=>n+(x===goals[0][i]?1:0),0)===Math.max(...states.map(st=>st.reduce((n,x,i)=>n+(x===goals[0][i]?1:0),0))))]||states[0]
  const expected=goals[0].map((v,i)=>`${NAMES[i]} ${v?'straight':'curled'}`).join(', ')
  const observed=bestState.map((v,i)=>`${NAMES[i]} ${v?'straight':'curled'}`).join(', ')
  const wrong=bestState.findIndex((v,i)=>v!==goals[0][i])
  const tip=goals.length===2&&states.length<2?'Keep both hands visible at the same time.':wrong===-1?'Your finger positions match this basic drill. Hold steady.':`Try ${goals[0][wrong]?'straightening':'curling'} your ${NAMES[wrong]} finger.`
  return {score:Math.round(score),observed,expected,tip,hands:states.length,fingerStates:states}
}

const progressKey='sign-drill-completion-v1'
export default function Tutor(){
  const [selected,setSelected]=useState<Drill>(DRILLS[0])
  const [completed,setCompleted]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(progressKey)||'[]')}catch{return []}})
  const [active,setActive]=useState(false)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [assessment,setAssessment]=useState<Assessment|null>(null)
  const [stability,setStability]=useState(0)
  const [explanation,setExplanation]=useState('')
  const [feedbackLoading,setFeedbackLoading]=useState(false)
  const [simulated,setSimulated]=useState(false)
  const videoRef=useRef<HTMLVideoElement|null>(null),canvasRef=useRef<HTMLCanvasElement|null>(null)
  const mediaRef=useRef<MediaStream|null>(null),detectorRef=useRef<HandLandmarker|null>(null)
  const frameRef=useRef<number>(0),liveRef=useRef(false),lastFrame=useRef(0),stableRef=useRef(0)
  const complete=useCallback((id:string)=>setCompleted(prev=>{
    if(prev.includes(id))return prev
    const next=[...prev,id];localStorage.setItem(progressKey,JSON.stringify(next));return next
  }),[])
  const stop=useCallback(()=>{
    liveRef.current=false;cancelAnimationFrame(frameRef.current)
    mediaRef.current?.getTracks().forEach(track=>track.stop());mediaRef.current=null
    if(videoRef.current)videoRef.current.srcObject=null
    setActive(false);setLoading(false);setStability(0);stableRef.current=0
  },[])
  useEffect(()=>()=>{stop();detectorRef.current?.close();detectorRef.current=null},[stop])
  const choose=(drill:Drill)=>{stop();setSelected(drill);setAssessment(null);setError('');setExplanation('');setSimulated(false)}

  const start=async()=>{
    stop();setError('');setExplanation('');setSimulated(false);setLoading(true)
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false})
      mediaRef.current=stream
      if(!videoRef.current)throw new Error('Camera view unavailable.')
      const video=videoRef.current;video.srcObject=stream;await video.play()
      if(!detectorRef.current){
        const {FilesetResolver,HandLandmarker}=await import('@mediapipe/tasks-vision')
        const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm')
        detectorRef.current=await HandLandmarker.createFromOptions(vision,{
          baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'CPU'},
          runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.4,
        })
      }
      liveRef.current=true;setActive(true);setLoading(false)
      const draw=()=>{
        if(!liveRef.current||!videoRef.current||!detectorRef.current)return
        const now=performance.now()
        if(now-lastFrame.current>95&&video.readyState>=2){
          lastFrame.current=now
          const result=detectorRef.current.detectForVideo(video,now)
          const canvas=canvasRef.current
          if(canvas){
            const w=video.videoWidth||640,h=video.videoHeight||480
            if(canvas.width!==w){canvas.width=w;canvas.height=h}
            const c=canvas.getContext('2d')
            if(c){c.clearRect(0,0,w,h);c.lineWidth=2.5;c.strokeStyle='#cefba8';c.fillStyle='#f6ffe8'
              for(const hand of result.landmarks){
                for(const [a,b] of CONNECTIONS){c.beginPath();c.moveTo(hand[a].x*w,hand[a].y*h);c.lineTo(hand[b].x*w,hand[b].y*h);c.stroke()}
                for(const landmark of hand){c.beginPath();c.arc(landmark.x*w,landmark.y*h,3.5,0,Math.PI*2);c.fill()}
              }
            }
          }
          const assessed=assessHands(result.landmarks,selected.target)
          setAssessment(assessed)
          if(assessed.score>=87 && (selected.target!=='two-open'||assessed.hands>=2)){
            stableRef.current=Math.min(12,stableRef.current+1)
          }else stableRef.current=Math.max(0,stableRef.current-2)
          setStability(stableRef.current)
          if(stableRef.current>=12)complete(selected.id)
        }
        frameRef.current=requestAnimationFrame(draw)
      }
      frameRef.current=requestAnimationFrame(draw)
    }catch(exc){stop();setError(exc instanceof Error?exc.message:String(exc))}
  }
  const nextDrill=()=>{const idx=DRILLS.findIndex(d=>d.id===selected.id);choose(DRILLS[(idx+1)%DRILLS.length])}
  const simulate=()=>{stop();setSimulated(true);setAssessment({score:65,observed:'index straight, middle straight, ring curled, little straight',
    expected:'index straight, middle straight, ring straight, little straight',tip:'Try straightening your ring finger.',hands:1,fingerStates:[[1,1,0,1]]})}
  const explain=async()=>{if(!assessment)return;setFeedbackLoading(true);setExplanation(await generateFeedback(selected.title,assessment.observed,assessment.expected,assessment.score));setFeedbackLoading(false)}
  const targetDescription=selected.target==='two-open'?'Both hands open':selected.target==='open'?'Open palm':selected.target==='index'?'Only index extended':'Closed fist'
  const isDone=completed.includes(selected.id)
  return <div className="page-content tutor-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> LEARNING STUDIO</div><h1>A little practice goes a long way<span className="heading-period">.</span></h1><p>Follow the avatar, turn on your camera, and get precise handshape feedback.</p></div>
      <div className="lesson-total"><GraduationCap size={19}/><span><strong>{completed.length} / {DRILLS.length}</strong> drills completed</span></div></div>
    <div className="lesson-layout">
      <aside className="lesson-sidebar"><div className="lesson-side-header"><span>YOUR LEARNING PATH</span><strong>{Math.round(completed.length/DRILLS.length*100)}%</strong></div><div className="progress-rail"><span style={{width:`${completed.length/DRILLS.length*100}%`}}/></div>
        {([1,2,3] as const).map(level=><div className="level-group" key={level}><div className="level-label"><span>LEVEL {level}</span><span>{level===1?'Fundamentals':level===2?'Precision':'Coordination'}</span></div>
          {DRILLS.filter(d=>d.level===level).map(drill=><button key={drill.id} className={`lesson-select ${selected.id===drill.id?'selected':''}`} onClick={()=>choose(drill)}><span className="lesson-no">{completed.includes(drill.id)?<Check size={16}/>:String(DRILLS.indexOf(drill)+1).padStart(2,'0')}</span><span className="lesson-select-title">{drill.title}<small>{drill.level===1?'Foundational handshape':drill.level===2?'Finger isolation':'Two-hand practice'}</small></span>{completed.includes(drill.id)&&<CheckCircle2 size={16} className="completed-icon"/>}</button>)}</div>)}
        <div className="lesson-side-note"><Info size={16}/><span>These are introductory handshape drills, not certified ASL lessons.</span></div>
      </aside>
      <div className="lesson-workspace"><div className="lesson-workspace-header"><div><div className="eyebrow subtle">LEVEL {selected.level} / DRILL {DRILLS.indexOf(selected)+1}</div><h2>{selected.title}</h2><p>{selected.intro}</p></div><span className={`lesson-state ${isDone?'done':''}`}>{isDone?<><Check size={15}/> Completed</>:'IN PROGRESS'}</span></div>
        <div className="practice-stage">
          <div className="reference-view"><div className="view-label"><Eye size={16}/> REFERENCE MOTION</div><Avatar clipId={selected.clipId} compact/><div className="reference-caption">Illustrative avatar · not validated ASL</div></div>
          <div className="camera-view"><div className="view-label"><ScanLine size={16}/> YOUR CAMERA {active&&<span className="camera-live"><span className="pulse-dot"/> TRACKING</span>}</div>
            <video ref={videoRef} muted playsInline autoPlay className={`camera-video ${active?'visible':''}`}/><canvas ref={canvasRef} className={`camera-overlay ${active?'visible':''}`}/>
            {!active&&<div className="camera-empty"><div className="camera-outline"><Camera size={34}/></div><strong>{loading?'Loading camera model...':'Your practice space'}</strong><span>{loading?'The first load downloads the MediaPipe model.':'Your webcam stays in your browser; only optional handshape metrics reach the backend.'}</span></div>}
            {active&&<div className="camera-corner"><span>HAND TRACKING / {assessment?.hands||0} DETECTED</span></div>}
          </div>
        </div>
        <div className="practice-controls"><div className="practice-instruction"><Target size={17}/><span>Target: <strong>{targetDescription}</strong></span></div><div className="practice-action-row">{!active?<button className="primary-button" disabled={loading} onClick={()=>void start()}><Camera size={17}/>{loading?'Starting...':'Enable webcam'}</button>:<button className="secondary-button" onClick={stop}><CameraOff size={16}/> Stop webcam</button>}<button className="ghost-button" onClick={simulate}>Try sample feedback</button></div></div>
        {error&&<div className="inline-error tutor-error"><CircleAlert size={16}/>{error} · The demo-feedback button works without a camera.</div>}
        <div className="feedback-panel"><div className="feedback-header"><span><Sparkles size={17}/> HANDSHAPE COACH</span>{simulated&&<span className="simulation-label">SIMULATED EXAMPLE</span>}</div>
          {assessment?<><div className="feedback-score-row"><div className="feedback-score"><span>{assessment.score}<small>%</small></span><small>Finger match</small></div><div className="feedback-detail"><strong>{assessment.tip}</strong><p>{assessment.observed}</p><div className="stability-container"><div className="stability-bar"><span style={{width:`${stability/12*100}%`}}/></div><small>{isDone?'Drill complete':simulated?'Sample only — no real drill completion':`Hold a matching pose: ${stability}/12 frames`}</small></div></div></div>
              <div className="feedback-actions"><button className="secondary-button small" onClick={()=>void explain()} disabled={feedbackLoading}>{feedbackLoading?'Generating...':'Explain my feedback'} <Sparkles size={13}/></button>{isDone&&<button className="primary-button small" onClick={nextDrill}>Next drill <ArrowRight size={14}/></button>}</div>{explanation&&<p className="ai-explanation">{explanation}</p>}
            </>:<div className="feedback-placeholder"><ScanLine size={25}/><div><strong>Ready when you are.</strong><span>Enable your webcam to compare your finger positions to the target drill, or preview sample feedback.</span></div></div>}
        </div>
        <div className="tips-panel"><span className="mini-heading">YOUR CHECKLIST</span>{selected.instructions.map((step,i)=><div key={i} className="tip-row"><span className="tip-number">0{i+1}</span>{step}</div>)}<div className="lesson-nav"><button className="text-button" onClick={()=>choose(DRILLS[Math.max(0,DRILLS.indexOf(selected)-1)])} disabled={selected.id===DRILLS[0].id}><ArrowLeft size={15}/> Previous</button><button className="text-button" onClick={nextDrill}>Next drill <ArrowRight size={15}/></button></div></div>
      </div>
    </div>
    <div className="tutor-disclaimer"><LockKeyhole size={15}/> Camera frames are processed locally by MediaPipe. The AI explanation receives measured finger states, not video. Sign-language fluency is not assessed.</div>
  </div>
}

import {useCallback,useEffect,useRef,useState} from 'react'
import {ArrowRight,Camera,CameraOff,Check,CheckCircle2,CircleAlert,Eye,GraduationCap,Info,LockKeyhole,Pause,Play,RotateCcw,ScanLine,Sparkles,Target} from 'lucide-react'
import type {HandLandmarker} from '@mediapipe/tasks-vision'
import Avatar from './Avatar'
import {generateFeedback} from '../api'
import {LEARNING_ITEMS,LESSONS,learningItem} from '../learning'
import type {HandshapeTarget,LearningItem} from '../types'

type NormalizedLandmark={x:number;y:number;z:number}
type PracticeState='locked'|'ready'|'countdown'|'tracking'|'feedback'|'completed'
type FingerCheck={name:string;expected:'straight'|'curled';actual:'straight'|'curled';matched:boolean}
type HandshapeResult={score:number;matched:boolean;observed:string;expected:string;tip:string;hands:number;fingerStates:number[][];fingerChecks:FingerCheck[]}
type PracticeResult={handshape?:HandshapeResult;position?:never;orientation?:never;movement?:never;overall?:number}

const CONNECTIONS:[[number,number],...Array<[number,number]>]=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]]
const NAMES=['Index','Middle','Ring','Little']
const TARGETS:Record<HandshapeTarget,number[][]>={open:[[1,1,1,1]],fist:[[0,0,0,0]],index:[[1,0,0,0]],'two-open':[[1,1,1,1],[1,1,1,1]]}
const progressKey='sign-drill-completion-v1'
const attemptMs=5000
const mediaPipeBase=`${import.meta.env.BASE_URL}mediapipe`

function practiceStartupError(cause:unknown,stage:'camera'|'video'|'tracker'){
  if(!window.isSecureContext)return 'Webcam access requires HTTPS or localhost. Open Sign from a secure URL.'
  if(!navigator.mediaDevices?.getUserMedia)return 'This browser does not expose webcam access. Try a current version of Chrome, Edge, Firefox, or Safari.'
  if(cause instanceof DOMException){
    if(cause.name==='NotAllowedError'||cause.name==='SecurityError')return 'Camera permission is blocked. Allow camera access for this site in your browser settings, then try again.'
    if(cause.name==='NotFoundError')return 'No camera was found. Connect a webcam and try again.'
    if(cause.name==='NotReadableError')return 'The camera is already in use by another app or browser tab.'
    if(cause.name==='OverconstrainedError')return 'The webcam cannot provide a compatible video stream.'
    if(cause.message)return cause.message
  }
  if(stage==='tracker')return 'The webcam opened, but the bundled hand tracker could not start. Reload the page and try again.'
  if(stage==='video')return 'The browser could not start the webcam preview. Check the site camera permission and try again.'
  if(cause instanceof Error&&cause.message)return `The webcam could not start: ${cause.message}`
  return 'The webcam could not start. Check the site camera permission and try again.'
}

function angle(a:NormalizedLandmark,b:NormalizedLandmark,c:NormalizedLandmark){
  const u=[a.x-b.x,a.y-b.y,a.z-b.z],v=[c.x-b.x,c.y-b.y,c.z-b.z]
  const dot=u.reduce((acc,x,i)=>acc+x*v[i],0)
  const len=(p:number[])=>Math.sqrt(p.reduce((sum,x)=>sum+x*x,0))
  return Math.acos(Math.max(-1,Math.min(1,dot/(len(u)*len(v)+1e-9))))*180/Math.PI
}
export function fingerState(points:NormalizedLandmark[]):number[]{return [[5,6,8],[9,10,12],[13,14,16],[17,18,20]].map(([m,p,t])=>angle(points[m],points[p],points[t])>145?1:0)}
export function assessHands(landmarks:NormalizedLandmark[][],target:HandshapeTarget):HandshapeResult{
  const goals=TARGETS[target],states=landmarks.map(fingerState)
  if(!states.length)return {score:0,matched:false,observed:'No hands detected',expected:goals.length===2?'Both palms open':'One hand in frame',tip:'Bring your full hand into the webcam frame.',hands:0,fingerStates:[],fingerChecks:[]}
  const scoreFor=(state:number[])=>goals[0].reduce((sum,expect,index)=>sum+(state[index]===expect?1:0),0)/4
  const ranked=states.map(state=>({state,score:scoreFor(state)})).sort((a,b)=>b.score-a.score)
  const score=(goals.length===2?(ranked[0].score+(ranked[1]?.score??0))/2:ranked[0].score)*100
  const best=ranked[0].state
  const fingerChecks=best.map((value,index)=>({name:NAMES[index],expected:goals[0][index]?'straight':'curled',actual:value?'straight':'curled',matched:value===goals[0][index]} as FingerCheck))
  const wrong=fingerChecks.find(check=>!check.matched)
  const tip=goals.length===2&&states.length<2?'Keep both hands visible at the same time.':wrong?`Try ${wrong.expected==='straight'?'straightening':'curling'} your ${wrong.name.toLowerCase()} finger.`:'Your measured finger positions match the target. Hold steady.'
  return {score:Math.round(score),matched:score>=87&&(goals.length===1||states.length>=2),observed:fingerChecks.map(check=>`${check.name.toLowerCase()} ${check.actual}`).join(', '),expected:fingerChecks.map(check=>`${check.name.toLowerCase()} ${check.expected}`).join(', '),tip,hands:states.length,fingerStates:states,fingerChecks}
}
function initialState(item:LearningItem):PracticeState{return item.practice.enabled?'ready':'locked'}

export default function Tutor(){
  const [selected,setSelected]=useState<LearningItem>(LEARNING_ITEMS[0])
  const [completed,setCompleted]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(progressKey)||'[]')}catch{return []}})
  const [state,setState]=useState<PracticeState>(initialState(selected))
  const [cameraActive,setCameraActive]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [result,setResult]=useState<PracticeResult|null>(null),[stability,setStability]=useState(0),[handsDetected,setHandsDetected]=useState(0),[countdown,setCountdown]=useState(3)
  const [attempts,setAttempts]=useState<Record<string,number[]>>({}),[explanation,setExplanation]=useState(''),[feedbackLoading,setFeedbackLoading]=useState(false)
  const [avatarRun,setAvatarRun]=useState(0),[avatarPaused,setAvatarPaused]=useState(false),[avatarSpeed,setAvatarSpeed]=useState(1)
  const videoRef=useRef<HTMLVideoElement|null>(null),canvasRef=useRef<HTMLCanvasElement|null>(null),mediaRef=useRef<MediaStream|null>(null),detectorRef=useRef<HandLandmarker|null>(null)
  const frameRef=useRef(0),liveRef=useRef(false),lastFrame=useRef(0),stableRef=useRef(0),trackingStart=useRef(0),cameraSession=useRef(0)
  const stateRef=useRef<PracticeState>(state),selectedRef=useRef(selected),bestRef=useRef<HandshapeResult|null>(null)
  stateRef.current=state;selectedRef.current=selected

  const enabledItems=LEARNING_ITEMS.filter(item=>item.practice.enabled),completedEnabled=enabledItems.filter(item=>completed.includes(item.id)).length
  const progress=Math.round(completedEnabled/enabledItems.length*100),currentLesson=LESSONS.find(lesson=>lesson.id===selected.lessonId)??LESSONS[0]
  const lessonEnabled=currentLesson.items.map(learningItem).filter(item=>item.practice.enabled),lessonComplete=lessonEnabled.length>0&&lessonEnabled.every(item=>completed.includes(item.id))
  const selectedIndex=LEARNING_ITEMS.findIndex(item=>item.id===selected.id),nextItem=LEARNING_ITEMS[selectedIndex+1]
  const handshape=result?.handshape,itemAttempts=attempts[selected.id]??[]

  const persistCompletion=useCallback((id:string)=>setCompleted(previous=>{if(previous.includes(id))return previous;const next=[...previous,id];localStorage.setItem(progressKey,JSON.stringify(next));return next}),[])
  const recordAttempt=useCallback((score:number)=>setAttempts(previous=>({...previous,[selectedRef.current.id]:[...(previous[selectedRef.current.id]??[]),score].slice(-5)})),[])
  const stopCamera=useCallback(()=>{cameraSession.current++;liveRef.current=false;cancelAnimationFrame(frameRef.current);mediaRef.current?.getTracks().forEach(track=>track.stop());mediaRef.current=null;if(videoRef.current)videoRef.current.srcObject=null;setCameraActive(false);setLoading(false);setHandsDetected(0);stableRef.current=0;setStability(0);const next=initialState(selectedRef.current);setState(next);stateRef.current=next},[])
  useEffect(()=>()=>{stopCamera();detectorRef.current?.close();detectorRef.current=null},[stopCamera])
  const resetAttempt=useCallback(()=>{stableRef.current=0;setStability(0);bestRef.current=null;setResult(null);setExplanation('');setError('')},[])
  const choose=useCallback((item:LearningItem)=>{selectedRef.current=item;setSelected(item);resetAttempt();setAvatarPaused(false);setAvatarRun(run=>run+1);const next=initialState(item);setState(next);stateRef.current=next},[resetAttempt])
  const finishAttempt=useCallback((complete:boolean)=>{const best=bestRef.current;if(best)recordAttempt(best.score);if(complete){persistCompletion(selectedRef.current.id);setState('completed');stateRef.current='completed'}else{setState('feedback');stateRef.current='feedback'}},[persistCompletion,recordAttempt])
  const processFrame=useCallback((landmarks:NormalizedLandmark[][],now:number)=>{setHandsDetected(landmarks.length);if(stateRef.current!=='tracking')return;const target=selectedRef.current.practice.targetHandState;if(!target)return;const assessed=assessHands(landmarks,target);if(!bestRef.current||assessed.score>=bestRef.current.score)bestRef.current=assessed;setResult({handshape:assessed,overall:assessed.score});if(assessed.matched)stableRef.current=Math.min(12,stableRef.current+1);else stableRef.current=Math.max(0,stableRef.current-2);setStability(stableRef.current);if(stableRef.current>=12)finishAttempt(true);else if(now-trackingStart.current>=attemptMs)finishAttempt(false)},[finishAttempt])

  const startCamera=async()=>{resetAttempt();setLoading(true);const session=++cameraSession.current;let startupStage:'camera'|'video'|'tracker'='camera';try{
    if(!window.isSecureContext)throw new DOMException('Camera access requires a secure context.','SecurityError')
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera API unavailable.')
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false})
    if(session!==cameraSession.current){stream.getTracks().forEach(track=>track.stop());return}mediaRef.current=stream
    startupStage='video';if(!videoRef.current)throw new Error('Camera view unavailable.');const video=videoRef.current;video.srcObject=stream;await video.play()
    if(session!==cameraSession.current){stream.getTracks().forEach(track=>track.stop());return}setCameraActive(true)
    startupStage='tracker';if(!detectorRef.current){const {FilesetResolver,HandLandmarker}=await import('@mediapipe/tasks-vision');const vision=await FilesetResolver.forVisionTasks(`${mediaPipeBase}/wasm`);const detector=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${mediaPipeBase}/models/hand_landmarker.task`,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.4});if(session!==cameraSession.current){detector.close();stream.getTracks().forEach(track=>track.stop());return}detectorRef.current=detector}
    if(session!==cameraSession.current)return
    liveRef.current=true;setLoading(false);setState('ready');stateRef.current='ready'
    const draw=()=>{if(!liveRef.current||!videoRef.current||!detectorRef.current)return;const now=performance.now();if(now-lastFrame.current>95&&video.readyState>=2){lastFrame.current=now;const detection=detectorRef.current.detectForVideo(video,now);const canvas=canvasRef.current;if(canvas){const width=video.videoWidth||640,height=video.videoHeight||480;if(canvas.width!==width){canvas.width=width;canvas.height=height}const context=canvas.getContext('2d');if(context){context.clearRect(0,0,width,height);context.lineWidth=2.5;context.strokeStyle='#cefba8';context.fillStyle='#f6ffe8';for(const hand of detection.landmarks){for(const [a,b] of CONNECTIONS){context.beginPath();context.moveTo(hand[a].x*width,hand[a].y*height);context.lineTo(hand[b].x*width,hand[b].y*height);context.stroke()}for(const landmark of hand){context.beginPath();context.arc(landmark.x*width,landmark.y*height,3.5,0,Math.PI*2);context.fill()}}}}processFrame(detection.landmarks,now)}frameRef.current=requestAnimationFrame(draw)};frameRef.current=requestAnimationFrame(draw)
  }catch(cause){const interrupted=session!==cameraSession.current;stopCamera();if(!interrupted)setError(practiceStartupError(cause,startupStage))}}
  const beginCountdown=()=>{if(!cameraActive)return;resetAttempt();setCountdown(3);setState('countdown');stateRef.current='countdown'}
  useEffect(()=>{if(state!=='countdown')return;const timer=setTimeout(()=>{if(countdown>1)setCountdown(value=>value-1);else{trackingStart.current=performance.now();setState('tracking');stateRef.current='tracking'}},800);return()=>clearTimeout(timer)},[state,countdown])
  const continueLearning=()=>{if(nextItem)choose(nextItem)}
  const explain=async()=>{if(!handshape)return;setFeedbackLoading(true);setExplanation(await generateFeedback(selected.name,handshape.observed,handshape.expected,handshape.score));setFeedbackLoading(false)}
  const trackingLabel=loading&&cameraActive?'Camera ready · loading hand tracker…':state==='countdown'?`${countdown}`:state==='tracking'?(handsDetected?'Analyzing handshape…':'Move your hand fully into frame'):cameraActive?(handsDetected?'Hand detected ✓':'Camera ready · show your hand'):'Camera off'

  return <div className="page-content tutor-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> LEARNING STUDIO</div><h1>Learn it. Practice it. Keep going<span className="heading-period">.</span></h1><p>Study an illustrative reference, then practice the handshape with live visual feedback.</p></div><div className="lesson-total" aria-label={`${completedEnabled} of ${enabledItems.length} practice items completed`}><GraduationCap size={19}/><span><strong>{completedEnabled} / {enabledItems.length}</strong> practice items</span></div></div>
    <div className="lesson-layout"><aside className="lesson-sidebar"><div className="lesson-side-header"><span>YOUR LEARNING PATH</span><strong>{progress}%</strong></div><div className="progress-rail" role="progressbar" aria-label="Learning path progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{width:`${progress}%`}}/></div>
      {LESSONS.map(lesson=><div className="level-group" key={lesson.id}><div className="level-label"><span>{lesson.subtitle.toUpperCase()}</span><span>{lesson.title}</span></div>{lesson.items.map(id=>{const item=learningItem(id),done=completed.includes(id);return <button key={id} className={`lesson-select ${selected.id===id?'selected':''}`} onClick={()=>choose(item)}><span className="lesson-no">{done?<Check size={16}/>:String(LEARNING_ITEMS.findIndex(entry=>entry.id===id)+1).padStart(2,'0')}</span><span className="lesson-select-title">{item.name}<small>{item.practice.scopeLabel}</small></span>{done?<CheckCircle2 size={16} className="completed-icon"/>:!item.practice.enabled?<span className="demo-badge">DEMO</span>:null}</button>})}</div>)}
      <div className="lesson-side-note"><Info size={16}/><span>Feedback measures finger shape only. It does not validate a complete ASL sign.</span></div></aside>
      <div className="lesson-workspace"><div className="lesson-workspace-header"><div><div className="eyebrow subtle">{currentLesson.title.toUpperCase()} / ITEM {currentLesson.items.indexOf(selected.id)+1}</div><h2>{selected.name}</h2><p>{selected.description}</p></div><span className={`lesson-state ${completed.includes(selected.id)?'done':''}`}>{completed.includes(selected.id)?<><Check size={15}/> Completed</>:selected.practice.enabled?selected.practice.scopeLabel:'DEMONSTRATION ONLY'}</span></div>
        {lessonComplete&&<div className="lesson-complete" role="status"><CheckCircle2 size={21}/><div><strong>Lesson complete: {currentLesson.title}</strong><span>{lessonEnabled.map(item=>item.name).join(' · ')}</span></div></div>}
        <div className="sign-components" aria-label={`${selected.name} teaching components`}>{Object.entries(selected.components).map(([label,value])=>value?<div key={label}><span>{label.toUpperCase()}</span><strong>{value}</strong></div>:null)}</div>
        <div className="practice-stage"><div className="reference-view"><div className="view-label"><Eye size={16}/> REFERENCE MOTION</div><Avatar key={`${selected.animationId}-${avatarRun}`} clipId={selected.animationId} compact paused={avatarPaused} speed={avatarSpeed}/><div className="avatar-learning-controls"><button className="round-control" aria-label="Replay reference motion" onClick={()=>{setAvatarPaused(false);setAvatarRun(run=>run+1)}}><RotateCcw size={15}/></button><button className="round-control" aria-label={avatarPaused?'Resume reference motion':'Pause reference motion'} onClick={()=>setAvatarPaused(value=>!value)}>{avatarPaused?<Play size={15}/>:<Pause size={15}/>}</button>{[.5,.75,1].map(value=><button key={value} className={`speed-button ${avatarSpeed===value?'active':''}`} aria-label={`Play reference at ${value} times speed`} onClick={()=>setAvatarSpeed(value)}>{value}×</button>)}</div><div className="reference-caption">Illustrative reference · drag to rotate · not validated ASL</div></div>
          <div className="camera-view"><div className="view-label"><ScanLine size={16}/> YOUR CAMERA {cameraActive&&<span className="camera-live"><span className="pulse-dot"/> {loading?'LOADING TRACKER':'LIVE'}</span>}</div><video ref={videoRef} muted playsInline autoPlay className={`camera-video ${cameraActive?'visible':''}`}/><canvas ref={canvasRef} className={`camera-overlay ${cameraActive?'visible':''}`}/>{!cameraActive&&<div className="camera-empty"><div className="camera-outline"><Camera size={34}/></div><strong>{loading?'Requesting camera access…':selected.practice.enabled?'Your practice space':'Practice not available yet'}</strong><span>{loading?'Use the browser prompt to allow this site to use your webcam.':selected.practice.enabled?'Enable your webcam when you are ready to practice this handshape.':'This item needs movement, position, or mixed handshape analysis that the current coach cannot measure honestly.'}</span></div>}{cameraActive&&<><div className="camera-corner" aria-live="polite"><span>{trackingLabel}</span></div>{state==='countdown'&&<div className="practice-countdown" aria-live="assertive">{countdown}</div>}</>}</div></div>
        <div className="practice-controls"><div className="practice-instruction"><Target size={17}/><span>Practice scope: <strong>{selected.practice.scopeLabel}</strong></span></div><div className="practice-action-row">{selected.practice.enabled&&!cameraActive&&<button className="primary-button" aria-label={`Enable webcam to practice ${selected.name} handshape`} disabled={loading} onClick={()=>void startCamera()}><Camera size={17}/>{loading?'Waiting for camera…':'Practice this handshape'}</button>}{cameraActive&&state==='ready'&&!loading&&<button className="primary-button" onClick={beginCountdown}>I’m ready</button>}{cameraActive&&<button className="secondary-button" aria-label="Stop practice webcam" onClick={stopCamera}><CameraOff size={16}/> Stop webcam</button>}{!selected.practice.enabled&&nextItem&&<button className="primary-button" onClick={continueLearning}>Next item <ArrowRight size={14}/></button>}</div></div>
        {error&&<div className="inline-error tutor-error"><CircleAlert size={16}/>{error}</div>}
        <div className="feedback-panel" aria-live="polite"><div className="feedback-header"><span><Sparkles size={17}/> HANDSHAPE COACH</span><span className="scope-badge">{selected.practice.mode==='demo-only'?'NO SCORING':'HANDSHAPE ONLY'}</span></div>
          {state==='locked'?<div className="feedback-placeholder"><Info size={25}/><div><strong>Demonstration available.</strong><span>The current analyzer cannot score the movement, position, orientation, or mixed handshapes needed for this item.</span></div></div>:handshape?<><div className="feedback-score-row"><div className="feedback-score"><span>{handshape.score}<small>%</small></span><small>Handshape match</small></div><div className="feedback-detail"><strong>{handshape.tip}</strong><div className="finger-checks">{handshape.fingerChecks.map(check=><span key={check.name} className={check.matched?'matched':'needs-work'}>{check.matched?<Check size={13}/>:<CircleAlert size={13}/>} {check.name}: {check.actual}</span>)}</div><div className="stability-container"><div className="stability-bar"><span style={{width:`${stability/12*100}%`}}/></div><small>{state==='completed'?`${selected.name} handshape complete`:state==='tracking'?`Hold a matching shape: ${stability}/12 frames`:'Review the measured finger states, then retry when ready.'}</small></div></div></div><div className="feedback-actions">{(state==='feedback'||state==='completed')&&cameraActive&&<button className="secondary-button small" onClick={beginCountdown}>Try again</button>}<button className="secondary-button small" onClick={()=>void explain()} disabled={feedbackLoading}>{feedbackLoading?'Generating…':'Explain feedback'} <Sparkles size={13}/></button>{state==='completed'&&nextItem&&<button className="primary-button small" onClick={continueLearning}>Continue to {nextItem.name} <ArrowRight size={14}/></button>}</div>{itemAttempts.length>1&&<p className="attempt-improvement">Attempts: {itemAttempts.join('% → ')}%{itemAttempts.at(-1)!>itemAttempts[0]?' · Nice improvement.':''}</p>}{explanation&&<p className="ai-explanation">{explanation}</p>}</>:<div className="feedback-placeholder"><ScanLine size={25}/><div><strong>{cameraActive?'Camera ready.':'Study the reference first.'}</strong><span>{cameraActive?(loading?'Camera preview is ready while the hand tracker starts.':'Click “I’m ready” for a short countdown and measured attempt.'):'Enable your webcam when you want to practice the supported handshape.'}</span></div></div>}
        </div>
        <div className="tips-panel"><span className="mini-heading">WHAT TO FOCUS ON</span>{selected.instructions.map((step,index)=><div key={step} className="tip-row"><span className="tip-number">0{index+1}</span>{step}</div>)}</div>
      </div></div>
    <div className="tutor-disclaimer"><LockKeyhole size={15}/> Camera frames stay in the browser. Feedback is based on measured finger shape only; these prototype lessons are not a substitute for qualified ASL instruction.</div>
  </div>
}

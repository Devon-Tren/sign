import {useCallback,useEffect,useRef,useState} from 'react'
import {ArrowRight,Camera,CameraOff,Check,CheckCircle2,CircleAlert,Eye,GraduationCap,Info,LockKeyhole,Pause,Play,RotateCcw,ScanLine,Sparkles,Target} from 'lucide-react'
import type {HandLandmarker,PoseLandmarker} from '@mediapipe/tasks-vision'
import Avatar from './Avatar'
import {generateFeedback} from '../api'
import {LEARNING_ITEMS,LESSONS,learningItem} from '../learning'
import type {LearningItem} from '../types'
import {GRADING_VERSION,PracticeAttempt,observe,rubricFor,type Grade,type Side,type TrackedHand,type Point} from '../practiceGrading'

type Stage='observe'|'rehearse'|'attempt'|'results'
type AttemptPhase='idle'|'countdown'|'tracking'

const CONNECTIONS:[[number,number],...Array<[number,number]>]=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]]
const STAGES:{id:Stage;label:string}[]=[{id:'observe',label:'Observe'},{id:'rehearse',label:'Rehearse'},{id:'attempt',label:'Attempt'},{id:'results',label:'Results'}]
const progressKey=GRADING_VERSION
const attemptMs=12000
const mediaPipeBase=`${import.meta.env.BASE_URL}mediapipe`

function startupError(cause:unknown,step:'camera'|'video'|'tracker'){
  if(!window.isSecureContext)return 'Webcam access requires HTTPS or localhost. Open Sign from a secure URL.'
  if(!navigator.mediaDevices?.getUserMedia)return 'This browser does not expose webcam access. Try a current browser.'
  if(cause instanceof DOMException){
    if(cause.name==='NotAllowedError'||cause.name==='SecurityError')return 'Camera permission is blocked. Allow camera access for this site, then try again.'
    if(cause.name==='NotFoundError')return 'No camera was found. Connect a webcam and try again.'
    if(cause.name==='NotReadableError')return 'The camera is already in use by another app or browser tab.'
    if(cause.name==='OverconstrainedError')return 'The webcam cannot provide a compatible video stream.'
    if(cause.message)return cause.message
  }
  if(step==='tracker')return 'The camera opened, but the motion trackers could not start. Reload and try again.'
  if(step==='video')return 'The browser could not start the camera preview. Check camera permission and try again.'
  return cause instanceof Error?`The webcam could not start: ${cause.message}`:'The webcam could not start. Check camera permission and try again.'
}

export default function Tutor(){
  const [selected,setSelected]=useState<LearningItem>(LEARNING_ITEMS[0])
  const [completed,setCompleted]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(progressKey)||'[]').filter((id:unknown)=>typeof id==='string'&&!!rubricFor(id))}catch{return []}})
  const [stage,setStage]=useState<Stage>('observe'),[phase,setPhase]=useState<AttemptPhase>('idle')
  const [cameraActive,setCameraActive]=useState(false),[cameraRequested,setCameraRequested]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [result,setResult]=useState<Grade|null>(null),[stability,setStability]=useState(0),[handsDetected,setHandsDetected]=useState(0),[countdown,setCountdown]=useState(3)
  const [attempts,setAttempts]=useState<Record<string,number[]>>({}),[explanation,setExplanation]=useState(''),[feedbackLoading,setFeedbackLoading]=useState(false)
  const [signingHand,setSigningHand]=useState<Side>('Right')
  const signingHandRef=useRef<Side>('Right');signingHandRef.current=signingHand
  const [liveTip,setLiveTip]=useState('')
  const [avatarRun,setAvatarRun]=useState(0),[avatarPaused,setAvatarPaused]=useState(false),[avatarSpeed,setAvatarSpeed]=useState(1)
  const videoRef=useRef<HTMLVideoElement|null>(null),canvasRef=useRef<HTMLCanvasElement|null>(null),streamRef=useRef<MediaStream|null>(null),detectorRef=useRef<HandLandmarker|null>(null)
  const poseDetectorRef=useRef<PoseLandmarker|null>(null),attemptRef=useRef(new PracticeAttempt(selected.id)),lastVideoTime=useRef(-1)
  const frameRef=useRef(0),liveRef=useRef(false),lastFrame=useRef(0),stableRef=useRef(0),trackingStart=useRef(0),sessionRef=useRef(0)
  const phaseRef=useRef<AttemptPhase>(phase),selectedRef=useRef(selected),loadingRef=useRef(false)
  phaseRef.current=phase;selectedRef.current=selected

  const scorable=selected.practice.enabled&&Boolean(rubricFor(selected.id))
  const enabledItems=LEARNING_ITEMS.filter(item=>item.practice.enabled&&rubricFor(item.id))
  const completedEnabled=enabledItems.filter(item=>completed.includes(item.id)).length
  const progress=Math.round(completedEnabled/enabledItems.length*100)
  const currentLesson=LESSONS.find(lesson=>lesson.id===selected.lessonId)??LESSONS[0]
  const lessonEnabled=currentLesson.items.map(learningItem).filter(item=>item.practice.enabled&&rubricFor(item.id))
  const lessonComplete=lessonEnabled.length>0&&lessonEnabled.every(item=>completed.includes(item.id))
  const selectedIndex=LEARNING_ITEMS.findIndex(item=>item.id===selected.id),nextItem=LEARNING_ITEMS[selectedIndex+1]
  const itemAttempts=attempts[selected.id]??[]

  const persistCompletion=useCallback((id:string)=>setCompleted(previous=>{if(previous.includes(id))return previous;const next=[...previous,id];localStorage.setItem(progressKey,JSON.stringify(next));return next}),[])
  const recordAttempt=useCallback((score:number)=>setAttempts(previous=>({...previous,[selectedRef.current.id]:[...(previous[selectedRef.current.id]??[]),score].slice(-5)})),[])
  const resetAttempt=useCallback(()=>{stableRef.current=0;setStability(0);attemptRef.current=new PracticeAttempt(selectedRef.current.id);setLiveTip('');setResult(null);setExplanation('');setError('');setPhase('idle');phaseRef.current='idle'},[])

  const releaseCamera=useCallback(()=>{
    sessionRef.current++;liveRef.current=false;cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null
    if(videoRef.current)videoRef.current.srcObject=null
    loadingRef.current=false;setCameraActive(false);setCameraRequested(false);setLoading(false);setHandsDetected(0)
  },[])

  useEffect(()=>()=>{releaseCamera();detectorRef.current?.close();detectorRef.current=null;poseDetectorRef.current?.close();poseDetectorRef.current=null},[releaseCamera])

  const choose=useCallback((item:LearningItem)=>{
    releaseCamera();selectedRef.current=item;setSelected(item);resetAttempt();setStage('observe')
    setAvatarPaused(false);setAvatarRun(run=>run+1)
  },[releaseCamera,resetAttempt])

  const finishAttempt=useCallback(()=>{
    const grade=attemptRef.current.result()
    setResult(grade);recordAttempt(grade.score);if(grade.matched)persistCompletion(selectedRef.current.id)
    setPhase('idle');phaseRef.current='idle';setStage('results');releaseCamera()
  },[persistCompletion,recordAttempt,releaseCamera])

  const processFrame=useCallback((hands:TrackedHand[],pose:Point[],now:number,aspect:number)=>{
    setHandsDetected(hands.length)
    if(phaseRef.current!=='tracking')return
    const assessed=attemptRef.current.update(observe(hands,pose,signingHandRef.current,aspect,!!rubricFor(selectedRef.current.id)?.body,!!rubricFor(selectedRef.current.id)?.twoHands),now)
    stableRef.current=assessed.progress;setStability(assessed.progress);setLiveTip(assessed.tip)
    if(assessed.matched||now-trackingStart.current>=attemptMs)finishAttempt()
  },[finishAttempt])

  const startCamera=useCallback(async()=>{
    if(streamRef.current||loadingRef.current)return
    loadingRef.current=true;setLoading(true);setError('');const session=++sessionRef.current
    let startupStep:'camera'|'video'|'tracker'='camera'
    try{
      if(!window.isSecureContext)throw new DOMException('Secure context required.','SecurityError')
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera API unavailable.')
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720}},audio:false})
      if(session!==sessionRef.current){stream.getTracks().forEach(track=>track.stop());return}
      streamRef.current=stream;startupStep='video'
      if(!videoRef.current)throw new Error('Camera view unavailable.')
      const video=videoRef.current;video.srcObject=stream;await video.play()
      if(session!==sessionRef.current){stream.getTracks().forEach(track=>track.stop());return}
      setCameraActive(true);startupStep='tracker'
      if(!detectorRef.current){
        const {FilesetResolver,HandLandmarker}=await import('@mediapipe/tasks-vision')
        const vision=await FilesetResolver.forVisionTasks(`${mediaPipeBase}/wasm`)
        const detector=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${mediaPipeBase}/models/hand_landmarker.task`,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.4})
        if(session!==sessionRef.current){detector.close();stream.getTracks().forEach(track=>track.stop());return}
        detectorRef.current=detector
      }
      if(rubricFor(selectedRef.current.id)?.body&&!poseDetectorRef.current){
        const {FilesetResolver,PoseLandmarker}=await import('@mediapipe/tasks-vision')
        const vision=await FilesetResolver.forVisionTasks(`${mediaPipeBase}/wasm`)
        const poseDetector=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${mediaPipeBase}/models/pose_landmarker_lite.task`,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.7,minPosePresenceConfidence:.7,minTrackingConfidence:.7})
        if(session!==sessionRef.current){poseDetector.close();return}
        poseDetectorRef.current=poseDetector
      }
      if(session!==sessionRef.current)return
      lastVideoTime.current=-1
      liveRef.current=true;loadingRef.current=false;setLoading(false)
      const draw=()=>{
        if(!liveRef.current||!videoRef.current||!detectorRef.current)return
        const currentVideo=videoRef.current
        const now=performance.now()
        if(now-lastFrame.current>95&&currentVideo.readyState>=2&&currentVideo.currentTime!==lastVideoTime.current){
          lastFrame.current=now;lastVideoTime.current=currentVideo.currentTime;const detection=detectorRef.current.detectForVideo(currentVideo,now);const canvas=canvasRef.current
          if(canvas){
            const width=currentVideo.videoWidth||960,height=currentVideo.videoHeight||720
            if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
            const context=canvas.getContext('2d')
            if(context){context.clearRect(0,0,width,height);context.lineWidth=2.5;context.strokeStyle='#f0c66f';context.fillStyle='#fff4d4';for(const hand of detection.landmarks){for(const [a,b] of CONNECTIONS){context.beginPath();context.moveTo(hand[a].x*width,hand[a].y*height);context.lineTo(hand[b].x*width,hand[b].y*height);context.stroke()}for(const point of hand){context.beginPath();context.arc(point.x*width,point.y*height,3.5,0,Math.PI*2);context.fill()}}}
          }
          const pose=rubricFor(selectedRef.current.id)?.body?poseDetectorRef.current?.detectForVideo(currentVideo,now).landmarks[0]??[]:[]
          const hands:TrackedHand[]=detection.landmarks.map((points,i)=>({points,world:detection.worldLandmarks[i]??[],side:detection.handedness[i]?.[0]?.categoryName as Side,confidence:detection.handedness[i]?.[0]?.score??0}))
          processFrame(hands,pose,now,(currentVideo.videoWidth||960)/(currentVideo.videoHeight||720))
        }
        frameRef.current=requestAnimationFrame(draw)
      }
      frameRef.current=requestAnimationFrame(draw)
    }catch(cause){const interrupted=session!==sessionRef.current;releaseCamera();if(!interrupted)setError(startupError(cause,startupStep))}
  },[processFrame,releaseCamera])

  useEffect(()=>{if(stage==='rehearse'&&cameraRequested&&!cameraActive&&!loading)void startCamera()},[stage,cameraRequested,cameraActive,loading,startCamera])
  useEffect(()=>{
    if((stage!=='rehearse'&&stage!=='attempt')||!cameraActive||!streamRef.current||!videoRef.current)return
    const video=videoRef.current
    if(video.srcObject!==streamRef.current)video.srcObject=streamRef.current
    void video.play().catch(cause=>setError(startupError(cause,'video')))
  },[stage,cameraActive])

  const enterObserve=()=>{releaseCamera();resetAttempt();setStage('observe')}
  const enterRehearse=()=>{if(!scorable)return;resetAttempt();setStage('rehearse');setCameraRequested(true)}
  const beginAttempt=()=>{if(!cameraActive||loading)return;resetAttempt();setCountdown(3);setStage('attempt');setPhase('countdown');phaseRef.current='countdown'}
  useEffect(()=>{if(phase!=='countdown')return;const timer=setTimeout(()=>{if(countdown>1)setCountdown(value=>value-1);else{trackingStart.current=performance.now();setPhase('tracking');phaseRef.current='tracking'}},800);return()=>clearTimeout(timer)},[phase,countdown])

  useEffect(()=>{if(phase!=='tracking')return;const timer=setTimeout(finishAttempt,attemptMs);return()=>clearTimeout(timer)},[phase,finishAttempt])

  const retry=()=>{resetAttempt();setStage('rehearse');setCameraRequested(true)}
  const continueLearning=()=>{if(nextItem)choose(nextItem)}
  const explain=async()=>{if(!result)return;setFeedbackLoading(true);setExplanation(await generateFeedback(selected.name,result.observed,result.expected,result.score));setFeedbackLoading(false)}
  const trackingLabel=loading?'Loading motion trackers...':phase==='countdown'?`Starting in ${countdown}`:phase==='tracking'?(handsDetected?'Checking the movement sequence...':'Move your hand fully into frame'):handsDetected?'Hand detected':'Camera ready - show your hand'

  const avatar=<div className="reference-view"><div className="view-label"><Eye size={16}/> REFERENCE MOTION</div><Avatar key={`${selected.animationId}-${avatarRun}`} clipId={selected.animationId} compact paused={avatarPaused} speed={avatarSpeed}/><div className="avatar-learning-controls"><button className="round-control" aria-label="Replay reference motion" onClick={()=>{setAvatarPaused(false);setAvatarRun(run=>run+1)}}><RotateCcw size={15}/></button><button className="round-control" aria-label={avatarPaused?'Resume reference motion':'Pause reference motion'} onClick={()=>setAvatarPaused(value=>!value)}>{avatarPaused?<Play size={15}/>:<Pause size={15}/>}</button>{[.5,.75,1].map(value=><button key={value} className={`speed-button ${avatarSpeed===value?'active':''}`} aria-label={`Play reference at ${value} times speed`} onClick={()=>setAvatarSpeed(value)}>{value}x</button>)}</div><div className="reference-caption">Illustrative reference - drag to rotate - not validated ASL</div></div>
  const camera=<div className="camera-view"><div className="view-label"><ScanLine size={16}/> YOUR CAMERA {cameraActive&&<span className="camera-live"><span className="pulse-dot"/> LIVE</span>}</div><video ref={videoRef} muted playsInline autoPlay className={`camera-video ${cameraActive?'visible':''}`}/><canvas ref={canvasRef} className={`camera-overlay ${cameraActive?'visible':''}`}/>{!cameraActive&&<div className="camera-empty"><div className="camera-outline"><Camera size={34}/></div><strong>{loading?'Requesting camera access...':'Camera needed for rehearsal'}</strong><span>{loading?'Use the browser prompt to allow camera access.':'Try camera access again when your browser permission is ready.'}</span>{!loading&&<button className="secondary-button" onClick={()=>{setError('');setCameraRequested(true)}}><Camera size={16}/> Try camera</button>}</div>}{cameraActive&&<><div className="camera-corner" aria-live="polite"><span>{trackingLabel}</span></div>{stage==='attempt'&&phase==='tracking'&&<div className="hold-counter" aria-live="polite"><strong>{Math.round(stability*100)}%</strong><span>steps matched</span></div>}{phase==='countdown'&&<div className="practice-countdown" aria-live="assertive">{countdown}</div>}</>}</div>

  return <div className="page-content tutor-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> LEARNING STUDIO</div><h1>Learn it. Practice it. Keep going<span className="heading-period">.</span></h1><p>Observe the reference, rehearse beside it, then practice the required steps in order.</p></div><div className="lesson-total" aria-label={`${completedEnabled} of ${enabledItems.length} practice items completed`}><GraduationCap size={19}/><span><strong>{completedEnabled} / {enabledItems.length}</strong> practice items</span></div></div>
    <div className="lesson-layout"><aside className="lesson-sidebar"><div className="lesson-side-header"><span>YOUR LEARNING PATH</span><strong>{progress}%</strong></div><div className="progress-rail" role="progressbar" aria-label="Learning path progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{width:`${progress}%`}}/></div>
      {LESSONS.map(lesson=><div className="level-group" key={lesson.id}><div className="level-label"><span>{lesson.subtitle.toUpperCase()}</span><span>{lesson.title}</span></div>{lesson.items.map(id=>{const item=learningItem(id),done=completed.includes(id);return <button key={id} className={`lesson-select ${selected.id===id?'selected':''}`} onClick={()=>choose(item)}><span className="lesson-no">{done?<Check size={16}/>:String(LEARNING_ITEMS.findIndex(entry=>entry.id===id)+1).padStart(2,'0')}</span><span className="lesson-select-title">{item.name}<small>{item.practice.scopeLabel}</small></span>{done?<CheckCircle2 size={16} className="completed-icon"/>:!item.practice.enabled?<span className="demo-badge">DEMO</span>:null}</button>})}</div>)}
      <div className="lesson-side-note"><Info size={16}/><span>Completion requires every measured step in order. Camera feedback is practice guidance, not signer validation.</span></div></aside>
      <div className="lesson-workspace"><div className="lesson-workspace-header"><div><div className="eyebrow subtle">{currentLesson.title.toUpperCase()} / ITEM {currentLesson.items.indexOf(selected.id)+1}</div><h2>{selected.name}</h2><p>{selected.description}</p></div><span className={`lesson-state ${completed.includes(selected.id)?'done':''}`}>{completed.includes(selected.id)?<><Check size={15}/> Completed</>:scorable?selected.practice.scopeLabel:'DEMONSTRATION ONLY'}</span></div>
        {lessonComplete&&<div className="lesson-complete" role="status"><CheckCircle2 size={21}/><div><strong>Lesson complete: {currentLesson.title}</strong><span>{lessonEnabled.map(item=>item.name).join(' - ')}</span></div></div>}
        <div className="learning-stage-nav" aria-label="Practice stages">{STAGES.map((entry,index)=>{const unavailable=(!scorable&&entry.id!=='observe')||(entry.id==='attempt'&&!cameraActive)||(entry.id==='results'&&!result);return <button key={entry.id} className={stage===entry.id?'active':''} disabled={unavailable} onClick={()=>entry.id==='observe'?enterObserve():entry.id==='rehearse'?enterRehearse():entry.id==='attempt'?beginAttempt():setStage('results')}><span>{index+1}</span>{entry.label}</button>})}</div>
        <label className="practice-instruction">Signing hand <select aria-label="Signing hand" value={signingHand} disabled={stage==='attempt'||stage==='results'} onChange={e=>{setSigningHand(e.target.value as Side);resetAttempt()}}><option value="Right">Right</option><option value="Left">Left</option></select></label>
        <div className="sign-components" aria-label={`${selected.name} teaching components`}>{Object.entries(selected.components).map(([label,value])=>value?<div key={label}><span>{label.toUpperCase()}</span><strong>{value}</strong></div>:null)}</div>

        {stage==='observe'&&<div className="learning-stage-panel observe-stage"><div className="practice-stage observe-layout">{avatar}</div><div className="practice-controls"><div className="practice-instruction"><Eye size={17}/><span>Watch the complete reference before moving on.</span></div><div className="practice-action-row">{scorable?<button className="primary-button" onClick={enterRehearse}>Start rehearsal <ArrowRight size={14}/></button>:nextItem&&<button className="primary-button" onClick={continueLearning}>Next item <ArrowRight size={14}/></button>}</div></div>{!scorable&&<div className="inline-notice"><Info size={17}/><span>Scored practice is unavailable until this item has a movement rubric.</span></div>}</div>}
        {stage==='rehearse'&&<div className="learning-stage-panel"><div className="practice-stage rehearse-layout">{avatar}{camera}</div><div className="practice-controls"><div className="practice-instruction"><Target size={17}/><span>Rehearsal is ungraded. Keep your head, shoulders, and hands visible.</span></div><div className="practice-action-row"><button className="primary-button" disabled={!cameraActive||loading} onClick={beginAttempt}>Start scored attempt <ArrowRight size={14}/></button><button className="secondary-button" onClick={enterObserve}><CameraOff size={16}/> Stop practice</button></div></div></div>}
        {stage==='attempt'&&<div className="learning-stage-panel"><div className="attempt-heading"><div><span>PRACTICE ATTEMPT</span><strong>{selected.practice.scopeLabel}</strong></div><small>Match each step in order. Wrong shapes, missing hands, or an incomplete sequence cannot earn full credit.</small></div><div className="practice-stage attempt-layout">{camera}</div><div className="attempt-progress"><div className="stability-bar"><span style={{width:`${stability*100}%`}}/></div><span>{phase==='tracking'?liveTip:'Get ready to perform the steps.'}</span></div><div className="practice-action-row attempt-stop"><button className="secondary-button" onClick={enterObserve}><CameraOff size={16}/> Stop attempt</button></div></div>}
        {stage==='results'&&result&&<div className="learning-stage-panel results-stage" aria-live="polite"><div className="results-score"><span>{result.score}<small>%</small></span><div><strong>{result.matched?'Measured sequence complete':'Sequence incomplete'}</strong><p>Credit reflects the required steps completed in order. Hand tracking cannot confirm physical contact, facial expression, or ASL fluency.</p></div></div><div className="results-feedback"><strong>{result.tip}</strong><div className="finger-checks">{result.qualityChecks.map(check=><span key={check.name} className={check.passed?'matched':'needs-work'}>{check.passed?<Check size={13}/>:<CircleAlert size={13}/>} {check.name}: {check.passed?'good':'adjust'}</span>)}</div>{itemAttempts.length>1&&<p className="attempt-improvement">Attempts: {itemAttempts.join('% -> ')}%{itemAttempts.at(-1)!>itemAttempts[0]?' - Nice improvement.':''}</p>}{explanation&&<p className="ai-explanation">{explanation}</p>}</div><div className="feedback-actions"><button className="primary-button" onClick={retry}><RotateCcw size={15}/> Retry</button><button className="secondary-button" onClick={()=>void explain()} disabled={feedbackLoading}>{feedbackLoading?'Generating...':'Explain feedback'} <Sparkles size={13}/></button>{completed.includes(selected.id)&&nextItem&&<button className="secondary-button" onClick={continueLearning}>Continue to {nextItem.name} <ArrowRight size={14}/></button>}</div></div>}

        {error&&<div className="inline-error tutor-error"><CircleAlert size={16}/><span>{error}</span><button className="secondary-button small" onClick={()=>{setError('');setCameraRequested(true)}}>Try again</button></div>}
        <div className="tips-panel"><span className="mini-heading">WHAT TO FOCUS ON</span>{selected.instructions.map((step,index)=><div key={step} className="tip-row"><span className="tip-number">0{index+1}</span>{step}</div>)}</div>
      </div></div>
    <div className="tutor-disclaimer"><LockKeyhole size={15}/> Camera frames stay in the browser. Feedback checks measured practice steps; these prototype lessons are not a substitute for qualified ASL instruction.</div>
  </div>
}

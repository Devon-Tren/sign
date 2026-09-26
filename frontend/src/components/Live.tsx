import PlanPreview from './PlanPreview'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, Captions, ChevronDown, CircleAlert, Clock3, Download, Mic2, Pause, Play, RotateCcw, Send, SlidersHorizontal, Sparkles, Square, Volume2, Waves } from 'lucide-react'
import Avatar from './Avatar'
import { CLIP_LENGTH_MS } from '../clips'
import { DEMO_SCRIPT, LOCAL_PHRASES, localInterpret } from '../data'
import { fetchHealth, fetchPhrases, planASL } from '../api'
import type { Phrase, Segment, SelectedPhrase } from '../types'
import { useLiveAudio } from '../hooks/useLiveAudio'

export default function Live(){
  const [phrases,setPhrases]=useState<Phrase[]>(LOCAL_PHRASES)
  const [backend,setBackend]=useState<{status:string,live_configured:boolean,transcription_model:string,catalog_backend:string}|null>(null)
  const [segments,setSegments]=useState<Segment[]>([])
  const [partial,setPartial]=useState('')
  const [draft,setDraft]=useState('')
  const [speed,setSpeed]=useState(1)
  const [paused,setPaused]=useState(false)
  const [queue,setQueue]=useState<SelectedPhrase[]>([])
  const [playing,setPlaying]=useState<SelectedPhrase|null>(null)
  const [demoRunning,setDemoRunning]=useState(false)
  const [showHistory,setShowHistory]=useState(true)
  const [showSettings,setShowSettings]=useState(false)
  const nextId=useRef(1)
  const transcriptEnd=useRef<HTMLDivElement|null>(null)
  const demoTimer=useRef<ReturnType<typeof setInterval>|null>(null)
  const enqueue=useCallback((items:SelectedPhrase[])=>{
    setQueue(old=>[...old,...items].slice(-32))
  },[])
  const translationChain=useRef<Promise<void>>(Promise.resolve())
  const recentContext=useRef<string[]>([])
  const generation=useRef(0)
  const handleFinal=useCallback(async(text:string,source:Segment['source'])=>{
    text=text.trim()
    if(!text)return
    const id=nextId.current++, epoch=generation.current
    const context=[...recentContext.current]
    recentContext.current=[...context,text].slice(-5)
    setPartial('')
    setSegments(prev=>[...prev,{id,text,timestamp:new Date(),selected:[],source}].slice(-200))
    if(source==='demo'){
      const result=localInterpret(text,phrases)
      setSegments(prev=>prev.map(s=>s.id===id?{...s,selected:result.selected,coverage:result.coverage}:s))
      enqueue(result.selected)
      return
    }
    // Serialize translation to retain spoken order, while captions appear immediately.
    translationChain.current=translationChain.current.then(async()=>{
      if(epoch!==generation.current)return
      try {
        const result=await planASL(text,context)
        if(epoch!==generation.current)return
        const gloss=result.plan?.manual_sequence.map(step=>step.sign_id)||[]
        const selected:SelectedPhrase[]=result.validation?.executable && result.playback
          ? [{phrase_id:`plan-${id}`,label:text,matched_text:text,
              validation_status:result.review_status==='reviewed'?'validated':'illustrative',
              animation_file:null,playback:result.playback,gloss}] : []
        setSegments(prev=>prev.map(s=>s.id===id?{...s,selected,planResult:result,coverage:selected.length?undefined:'unsupported'}:s))
        enqueue(selected)
      } catch {
        if(epoch===generation.current)setSegments(prev=>prev.map(s=>s.id===id?{...s,coverage:'unsupported',planError:'Translator unavailable. Captions retained.'}:s))
      }
    })
    await translationChain.current
  },[phrases,enqueue])
  const partialCb=useCallback((text:string)=>setPartial(text),[])
  const finalCb=useCallback((text:string)=>{void handleFinal(text,'microphone')},[handleFinal])
  const live=useLiveAudio({onPartial:partialCb,onFinal:finalCb})
  useEffect(()=>{void fetchHealth().then(setBackend);void fetchPhrases().then(setPhrases)},[])
  useEffect(()=>{if(showHistory)transcriptEnd.current?.scrollIntoView({block:'nearest',behavior:'smooth'})},[segments,partial,showHistory])
  useEffect(()=>{
    if(paused||playing||queue.length===0)return
    const [next,...rest]=queue;setPlaying(next);setQueue(rest)
  },[queue,paused,playing])
  useEffect(()=>{
    if(!playing||paused||playing.playback)return
    const timer=setTimeout(()=>setPlaying(p=>p===playing?null:p), (CLIP_LENGTH_MS[playing.phrase_id]||1600)/speed)
    return ()=>clearTimeout(timer)
  },[playing,paused,speed])
  useEffect(()=>()=>{if(demoTimer.current)clearInterval(demoTimer.current)},[])
  const startDemo=()=>{
    if(demoTimer.current)clearInterval(demoTimer.current)
    generation.current++;recentContext.current=[];setSegments([]);setQueue([]);setPlaying(null);setPartial('');setDemoRunning(true)
    let index=0
    void handleFinal(DEMO_SCRIPT[index++],'demo')
    demoTimer.current=setInterval(()=>{
      if(index>=DEMO_SCRIPT.length){if(demoTimer.current)clearInterval(demoTimer.current);demoTimer.current=null;setDemoRunning(false);return}
      void handleFinal(DEMO_SCRIPT[index++],'demo')
    },4200)
  }
  const stopDemo=()=>{if(demoTimer.current)clearInterval(demoTimer.current);demoTimer.current=null;setDemoRunning(false)}
  const replay=()=>{const last=segments.flatMap(s=>s.selected).slice(-1)[0];if(last){setPlaying(null);setQueue(old=>[last,...old])}}
  const downloadTranscript=()=>{
    const content=['SIGN — lecture transcript','Prototype: animations are NOT verified ASL','',...segments.map(s=>`[${s.timestamp.toLocaleTimeString()}] ${s.text}`)].join('\n')
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'}))
    a.download=`sign-transcript-${new Date().toISOString().slice(0,10)}.txt`;a.click();URL.revokeObjectURL(a.href)
  }
  const startMic=async()=>{stopDemo();generation.current++;recentContext.current=[];setQueue([]);setPlaying(null);await live.start()}
  const currentGloss=playing?.gloss?.join(' · ')
  const currentLabel=currentGloss||playing?.label||'Ready when you are'
  return <div className="page-content live-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> THE CLASSROOM</div><h1>Every word, within reach<span className="heading-period">.</span></h1><p>Live captions, structured signing plans, and an animated 3D companion.</p></div>
      <div className="heading-actions"><span className="privacy-pill"><span className="privacy-dot"/> No audio storage in Sign</span><button className="icon-button" title="Export transcript" onClick={downloadTranscript} disabled={!segments.length}><Download size={18}/></button></div>
    </div>
    <div className="live-layout">
      <section className="avatar-panel">
        <div className="panel-top"><span className="mini-heading"><Waves size={17}/> YOUR LIVE COMPANION</span><span className={`mode-chip ${live.status==='listening'?'chip-live':''}`}>{playing?.playback?(playing.validation_status==='validated'?'REVIEWED SIGNING':'EXPERIMENTAL SIGNING'):live.status==='listening'?<><span className="pulse-dot"/> LISTENING</>:demoRunning?'DEMO RUNNING':'READY'}</span></div>
        <div className="avatar-stage"><div className="orb orb-one"/><div className="orb orb-two"/>
          <Avatar clipId={playing?.phrase_id||'idle'} paused={paused} speed={speed} timeline={playing?.playback} onComplete={()=>setPlaying(null)}/>
          <div className="stage-guidance"><span className="stage-index">{playing?.playback?'GLOSS / PLAYING':playing?'ANIMATION / PLAYING':'GLOSS / STANDBY'}</span><strong>{currentLabel}</strong><span>{playing?.playback?(playing.validation_status==='validated'?'Reviewed sequence':`Candidate rendering of “${playing.label}”`):playing?'Demonstration gesture only — unverified ASL':'Type a sentence or start the microphone'}</span></div>
          <div className="stage-vertical">SIGN / 001</div>
        </div>
        <div className="playback-panel"><div className="playback-now"><div className="playback-icon"><AudioLines size={19}/></div><div><strong>{playing?.playback?(playing.validation_status==='validated'?'Reviewed sequence':'Experimental gloss sequence'):playing?'Illustrative motion':'Translator ready'}</strong><span>{playing?.playback?`${playing.gloss?.length||0} motions · English: ${playing.label}`:playing?`Phrase: ${playing.label}`:'Text and final speech share this playback queue'}</span></div></div>
          <div className="playback-buttons"><button title={paused?'Resume animations':'Pause animations'} onClick={()=>setPaused(p=>!p)} className="round-control">{paused?<Play size={17}/>:<Pause size={17}/>}</button><button title="Replay last animated phrase" onClick={replay} disabled={!segments.some(s=>s.selected.length)} className="round-control"><RotateCcw size={16}/></button><button title="Playback settings" onClick={()=>setShowSettings(s=>!s)} className="round-control"><SlidersHorizontal size={16}/></button></div>
        </div>
        {showSettings&&<div className="speed-row"><label htmlFor="avatar-speed">Animation speed <strong>{speed.toFixed(1)}×</strong></label><input id="avatar-speed" aria-label="Avatar playback speed" type="range" min="0.5" max="1.5" step="0.1" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/></div>}
        <div className="safety-inline"><CircleAlert size={15}/><span>Prototype gestures are not validated ASL and cannot replace a qualified interpreter.</span></div>
      </section>
      <section className="transcript-panel"><div className="panel-top transcript-top"><span className="mini-heading"><Captions size={17}/> LIVE TRANSCRIPT</span><button className="text-button" onClick={()=>setShowHistory(s=>!s)}>{showHistory?'Hide':'Show'} history <ChevronDown size={14}/></button></div>
        <div className="transcript-main">
          <div className="transcript-status"><span className="transcript-indicator"/><span>{live.status==='listening'?'Transcribing your microphone':demoRunning?'Playing sample lecture':'Waiting for speech'}</span><span className="transcript-time"><Clock3 size={12}/> ENGLISH</span></div>
          <div className="transcript-scroll" aria-live="polite" aria-relevant="additions text">
            {segments.length===0&&!partial&&<div className="empty-transcript"><div className="empty-symbol"><Volume2 size={25}/></div><strong>Words become visible here.</strong><p>Try the sample lecture to see captions and the avatar in action, or connect your microphone.</p></div>}
            {segments.filter((_,i)=>showHistory||i>=segments.length-2).map(s=><article className="transcript-line" key={s.id}><div className="transcript-meta"><span className="transcript-speaker">{s.source==='demo'?'SAMPLE LECTURE':s.source==='text'?'MANUAL INPUT':'SPEAKER'}</span><time>{s.timestamp.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></div><p>{s.text}</p><div className="matched-chips">{s.selected.flatMap(clip=>clip.gloss||[clip.label]).map((label,i)=><span key={`${label}-${i}`} className="phrase-tag">{label}</span>)}{s.selected.some(clip=>clip.validation_status==='illustrative'&&clip.playback)&&<span className="unverified-tag">Experimental motion</span>}{s.coverage==='unsupported'&&<span className="unsupported-tag">Captions only</span>}{s.coverage==='illustrative-only'&&<span className="unverified-tag">Illustrative clips</span>}</div>{s.planError&&<p>{s.planError}</p>}{s.planResult&&<details><summary>{s.planResult.playback?(s.planResult.review_status==='reviewed'?'Reviewed signing plan':'Experimental gloss plan'):'Candidate plan · captions retained'}</summary><pre className="plan-json">{JSON.stringify(s.planResult,null,2)}</pre></details>}</article>)}
            {partial&&<article className="transcript-line interim"><div className="transcript-meta"><span className="transcript-speaker"><span className="pulse-dot"/> TRANSCRIBING</span></div><p>{partial}<span className="typing-cursor"/></p></article>}
            <div ref={transcriptEnd}/>
          </div>
          <div className="queue-info"><div className="queue-caption"><span>ANIMATION QUEUE</span><span>{queue.length} waiting</span></div><div className="queue-slots">{queue.length?queue.slice(0,3).map((clip,i)=><span className="queue-token" key={i}>{clip.label}</span>):<span className="quiet-note">No pending phrases</span>}</div></div>
        </div>
        <div className="input-zone">
          {live.error&&<div className="inline-error"><CircleAlert size={15}/>{live.error}</div>}
          <div className="entry-row"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){void handleFinal(draft,'text');setDraft('')}}} placeholder="Try typing a sentence..." aria-label="Type sample spoken text"/><button className="send-button" title="Add sentence to transcript" disabled={!draft.trim()} onClick={()=>{void handleFinal(draft,'text');setDraft('')}}><Send size={17}/></button></div>
          <div className="input-actions"><button className={`mic-button ${live.status==='listening'?'mic-active':''}`} disabled={live.status==='connecting'||live.status==='stopping'} onClick={live.status==='listening'?live.stop:startMic}>{live.status==='listening'?<><Square size={15}/> Stop microphone</>:<><Mic2 size={17}/> {live.status==='connecting'?'Connecting...':'Start microphone'}</>}</button>
            <button className="secondary-button" onClick={demoRunning?stopDemo:startDemo}>{demoRunning?<><Square size={14}/> Stop demo</>:<><Play size={14}/> Run sample lecture</>}</button></div>
          <div className="connection-hint"><span className={`small-dot ${backend?.live_configured?'green':'amber'}`}/>{backend?.live_configured?'Model translation and microphone configured':backend?'Local phrases and fingerspelling available · add API key for model gloss':'Local demo works without the backend'}{backend?.catalog_backend?` · catalog: ${backend.catalog_backend}`:''}{live.connectedModel?` · ${live.connectedModel}`:''}</div>
        </div>
      </section>
    </div>
    <PlanPreview/>
    <div className="bottom-feature-row"><div className="feature-note"><div className="feature-note-icon"><Sparkles size={18}/></div><div><strong>Shared text and audio translator</strong><span>Known concepts use candidate sign motions; unsupported words are fingerspelled. Every experimental sequence stays labelled.</span></div></div><div className="feature-note"><div className="feature-note-icon blue"><Clock3 size={18}/></div><div><strong>Built for ongoing lectures</strong><span>Captions appear immediately while gloss planning and avatar playback run in order.</span></div></div></div>
  </div>
}

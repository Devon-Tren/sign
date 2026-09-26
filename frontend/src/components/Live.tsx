import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, Captions, ChevronDown, CircleAlert, Clock3, Download, Mic2, Pause, Play, RotateCcw, Send, SlidersHorizontal, Sparkles, Square, Volume2, Waves } from 'lucide-react'
import Avatar from './Avatar'
import { CLIP_LENGTH_MS } from '../clips'
import { DEMO_SCRIPT, LOCAL_PHRASES, localInterpret } from '../data'
import { fetchHealth, fetchPhrases, interpret } from '../api'
import type { Phrase, Segment, SelectedPhrase } from '../types'
import { useLiveAudio } from '../hooks/useLiveAudio'

export default function Live(){
  const [phrases,setPhrases]=useState<Phrase[]>(LOCAL_PHRASES)
  const [backend,setBackend]=useState<{status:string,live_configured:boolean,transcription_model:string}|null>(null)
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
  const handleFinal=useCallback(async(text:string,source:Segment['source'])=>{
    if(!text.trim())return
    const id=nextId.current++
    setPartial('')
    setSegments(prev=>[...prev,{id,text:text.trim(),timestamp:new Date(),selected:[],source}].slice(-200))
    const result=source==='demo'?localInterpret(text,phrases):await interpret(text,phrases)
    setSegments(prev=>prev.map(s=>s.id===id?{...s,selected:result.selected,coverage:result.coverage}:s))
    enqueue(result.selected)
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
    if(!playing||paused)return
    const timer=setTimeout(()=>setPlaying(p=>p===playing?null:p), (CLIP_LENGTH_MS[playing.phrase_id]||1600)/speed)
    return ()=>clearTimeout(timer)
  },[playing,paused,speed])
  useEffect(()=>()=>{if(demoTimer.current)clearInterval(demoTimer.current)},[])
  const startDemo=()=>{
    if(demoTimer.current)clearInterval(demoTimer.current)
    setSegments([]);setQueue([]);setPlaying(null);setPartial('');setDemoRunning(true)
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
  const startMic=async()=>{stopDemo();await live.start()}
  const currentLabel=playing?.label||'Ready when you are'
  return <div className="page-content live-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> THE CLASSROOM</div><h1>Every word, within reach<span className="heading-period">.</span></h1><p>Live captions, contextual phrase retrieval, and an animated 3D companion.</p></div>
      <div className="heading-actions"><span className="privacy-pill"><span className="privacy-dot"/> No audio storage in Sign</span><button className="icon-button" title="Export transcript" onClick={downloadTranscript} disabled={!segments.length}><Download size={18}/></button></div>
    </div>
    <div className="live-layout">
      <section className="avatar-panel">
        <div className="panel-top"><span className="mini-heading"><Waves size={17}/> YOUR LIVE COMPANION</span><span className={`mode-chip ${live.status==='listening'?'chip-live':''}`}>{live.status==='listening'?<><span className="pulse-dot"/> LIVE</>:demoRunning?'DEMO RUNNING':'ILLUSTRATIVE PREVIEW'}</span></div>
        <div className="avatar-stage"><div className="orb orb-one"/><div className="orb orb-two"/>
          <Avatar clipId={playing?.phrase_id||'idle'} paused={paused} speed={speed}/>
          <div className="stage-guidance"><span className="stage-index">ANIMATION / {playing?'PLAYING':'STANDBY'}</span><strong>{currentLabel}</strong><span>{playing?'Demonstration gesture only — unverified ASL':'Rotate the character by dragging'}</span></div>
          <div className="stage-vertical">SIGN / 001</div>
        </div>
        <div className="playback-panel"><div className="playback-now"><div className="playback-icon"><AudioLines size={19}/></div><div><strong>{playing?'Illustrative motion':'Motion player ready'}</strong><span>{playing?`Phrase: ${playing.label}`:'Start a demo or connect your mic'}</span></div></div>
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
            {segments.filter((s,i)=>showHistory||i>=segments.length-2).map(s=><article className="transcript-line" key={s.id}><div className="transcript-meta"><span className="transcript-speaker">{s.source==='demo'?'SAMPLE LECTURE':s.source==='text'?'MANUAL INPUT':'SPEAKER'}</span><time>{s.timestamp.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></div><p>{s.text}</p><div className="matched-chips">{s.selected.map((clip,i)=><span key={`${clip.phrase_id}-${i}`} className="phrase-tag">{clip.label}</span>)}{s.coverage==='unsupported'&&<span className="unsupported-tag">Captions only</span>}{s.coverage==='illustrative-only'&&<span className="unverified-tag">Illustrative clips</span>}</div></article>)}
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
          <div className="connection-hint"><span className={`small-dot ${backend?.live_configured?'green':'amber'}`}/>{backend?.live_configured?'Live API configured':backend?'Set an API key to enable microphone':'Local demo works without the backend'}{live.connectedModel?` · ${live.connectedModel}`:''}</div>
        </div>
      </section>
    </div>
    <div className="bottom-feature-row"><div className="feature-note"><div className="feature-note-icon"><Sparkles size={18}/></div><div><strong>Context-aware phrase selection</strong><span>GPT-4.1 selects only known phrase IDs. Unknown content stays available as English captions.</span></div></div><div className="feature-note"><div className="feature-note-icon blue"><Clock3 size={18}/></div><div><strong>Built for ongoing lectures</strong><span>Captions update as speech arrives; animation playback runs in its own queue.</span></div></div></div>
  </div>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Download, Mic2, Send, Square, Waves } from 'lucide-react'
import Avatar from './Avatar'
import { CLIP_LENGTH_MS } from '../clips'
import { LOCAL_PHRASES, localInterpret } from '../data'
import { fetchHealth, fetchPhrases, planASL } from '../api'
import type { Phrase, Segment, SelectedPhrase } from '../types'
import { useLiveAudio } from '../hooks/useLiveAudio'

export default function Live(){
  const [phrases,setPhrases]=useState<Phrase[]>(LOCAL_PHRASES)
  const [backend,setBackend]=useState<{status:string,live_configured:boolean,transcription_model:string,catalog_backend:string}|null>(null)
  const [segments,setSegments]=useState<Segment[]>([])
  const [partial,setPartial]=useState('')
  const [draft,setDraft]=useState('')
  const [speed]=useState(1)
  const [paused]=useState(false)
  const [queue,setQueue]=useState<SelectedPhrase[]>([])
  const [playing,setPlaying]=useState<SelectedPhrase|null>(null)
  const nextId=useRef(1)
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
  useEffect(()=>{
    if(paused||playing||queue.length===0)return
    const [next,...rest]=queue;setPlaying(next);setQueue(rest)
  },[queue,paused,playing])
  useEffect(()=>{
    if(!playing||paused||playing.playback)return
    const timer=setTimeout(()=>setPlaying(p=>p===playing?null:p), (CLIP_LENGTH_MS[playing.phrase_id]||1600)/speed)
    return ()=>clearTimeout(timer)
  },[playing,paused,speed])
  const downloadTranscript=()=>{
    const content=['SIGN â€” lecture transcript','Prototype: animations are NOT verified ASL','',...segments.map(s=>`[${s.timestamp.toLocaleTimeString()}] ${s.text}`)].join('\n')
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'}))
    a.download=`sign-transcript-${new Date().toISOString().slice(0,10)}.txt`;a.click();URL.revokeObjectURL(a.href)
  }
  const startMic=async()=>{generation.current++;recentContext.current=[];setQueue([]);setPlaying(null);await live.start()}
  const currentGloss=playing?.gloss?.join(' Â· ')
  const latestTranscript=segments.at(-1)?.text
  const currentLabel=partial||latestTranscript||currentGloss||playing?.label||'Ready when you are'
  const stageMode=partial?'LIVE TRANSCRIPT':latestTranscript?'LATEST TRANSCRIPT':playing?.playback?'GLOSS / PLAYING':playing?'ANIMATION / PLAYING':'GLOSS / STANDBY'
  const stageHint=partial?'Listening as words come in':latestTranscript?'Latest words from the transcript':playing?.playback?(playing.validation_status==='validated'?'Reviewed sequence':`Candidate rendering of ${playing.label}`):playing?'Demonstration gesture only - unverified ASL':'Type a sentence or start the microphone'
  return <div className="page-content live-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> THE CLASSROOM</div><h1>Every word, within reach<span className="heading-period">.</span></h1><p>Live captions, structured signing plans, and an animated 3D companion.</p></div>
      <div className="heading-actions"><span className="privacy-pill"><span className="privacy-dot"/> No audio storage in Sign</span><button className="icon-button" title="Export transcript" onClick={downloadTranscript} disabled={!segments.length}><Download size={18}/></button></div>
    </div>
    <div className="live-layout">
      <section className="avatar-panel">
        <div className="panel-top"><span className="mini-heading"><Waves size={17}/> YOUR LIVE COMPANION</span><span className={live.status==='listening'?'mode-chip chip-live':'mode-chip'}>{playing?.playback?(playing.validation_status==='validated'?'REVIEWED SIGNING':'EXPERIMENTAL SIGNING'):live.status==='listening'?<><span className="pulse-dot"/> LISTENING</>:'READY'}</span></div>
        <div className="avatar-stage"><div className="orb orb-one"/><div className="orb orb-two"/>
          <Avatar clipId={playing?.phrase_id||'idle'} paused={paused} speed={speed} timeline={playing?.playback} onComplete={()=>setPlaying(null)}/>
          <div className="stage-guidance"><span className="stage-index">{stageMode}</span><strong>{currentLabel}</strong><span>{stageHint}</span></div>
          <div className="stage-vertical">SIGN / 001</div>
        </div>
        <div className="playback-panel live-control-panel">
          <div className="live-control-mic">
            <button className={`mic-button ${live.status==='listening'?'mic-active':''}`} disabled={live.status==='connecting'||live.status==='stopping'} onClick={live.status==='listening'?live.stop:startMic}>{live.status==='listening'?<><Square size={15}/> Stop</>:<><Mic2 size={17}/> {live.status==='connecting'?'Connecting...':'Mic'}</>}</button>
          </div>
          <div className="live-control-text">
            {live.error&&<div className="inline-error"><CircleAlert size={15}/>{live.error}</div>}
            <div className="entry-row"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){void handleFinal(draft,'text');setDraft('')}}} placeholder="Type a sentence for live interpretation..." aria-label="Type sample spoken text"/><button className="send-button" title="Add sentence to transcript" disabled={!draft.trim()} onClick={()=>{void handleFinal(draft,'text');setDraft('')}}><Send size={17}/></button></div>
            <div className="connection-hint"><span className={`small-dot ${backend?.live_configured?'green':'amber'}`}/>{backend?.live_configured?'Model translation and microphone configured':backend?'Local phrases and fingerspelling available Â· add API key for model gloss':'Local demo works without the backend'}{backend?.catalog_backend?` Â· catalog: ${backend.catalog_backend}`:''}{live.connectedModel?` Â· ${live.connectedModel}`:''}</div>
          </div>
        </div>
        <div className="safety-inline"><CircleAlert size={15}/><span>Prototype gestures are not validated ASL and cannot replace a qualified interpreter.</span></div>
      </section>
    </div>
  </div>
}

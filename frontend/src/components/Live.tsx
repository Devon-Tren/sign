import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Download, FileAudio, Mic2, Send, Square, Waves } from 'lucide-react'
import Avatar from './Avatar'
import { CLIP_LENGTH_MS } from '../clips'
import { LOCAL_PHRASES, localInterpret } from '../data'
import { fetchHealth, fetchPhrases, interpret, planASL, transcribeAudio } from '../api'
import type { Phrase, PlanResult, Segment, SelectedPhrase } from '../types'
import { useLiveAudio } from '../hooks/useLiveAudio'

export default function Live(){
  const [phrases,setPhrases]=useState<Phrase[]>(LOCAL_PHRASES)
  const [backend,setBackend]=useState<{status:string,live_configured:boolean,transcription_model:string,catalog_backend:string}|null>(null)
  const [segments,setSegments]=useState<Segment[]>([])
  const [partial,setPartial]=useState('')
  const [draft,setDraft]=useState('')
  const [importing,setImporting]=useState(false)
  const [fileError,setFileError]=useState('')
  const [queue,setQueue]=useState<SelectedPhrase[]>([])
  const [playing,setPlaying]=useState<SelectedPhrase|null>(null)
  const nextId=useRef(1)
  const fileInputRef=useRef<HTMLInputElement|null>(null)
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
      const result=localInterpret(text,phrases,context)
      const selected=result.selected.map(clip=>({...clip,rendering_source:'catalog' as const}))
      setSegments(prev=>prev.map(segment=>segment.id===id
        ? {...segment,selected,catalogMatches:selected,coverage:result.coverage,gate:result.gate}
        : segment))
      enqueue(selected)
      return
    }

    // Serialize checks so both transcript context and playback retain speech order.
    translationChain.current=translationChain.current.then(async()=>{
      if(epoch!==generation.current)return
      try {
        const result=await interpret(text,phrases,context)
        if(epoch!==generation.current)return
        const catalogMatches:SelectedPhrase[]=result.selected.map(clip=>({
          ...clip,
          match_confidence:clip.match_confidence??.96,
          match_threshold:clip.match_threshold??.90,
          match_kind:clip.match_kind??'exact',
          match_reason:clip.match_reason??'Exact stored phrase match.',
          rendering_source:'catalog',
        }))
        const gate=result.gate||{
          status:catalogMatches.length?'matched' as const:'captions-only' as const,
          strategy:'context-aware-catalog-v1' as const,
          confidence:catalogMatches.length?Math.min(...catalogMatches.map(clip=>clip.match_confidence)):0,
          context_used:false,
          reason:catalogMatches.length?'Stored catalog match.':'No stored meaning matched the transcript.',
        }
        let selected:SelectedPhrase[]=catalogMatches
        let planResult:PlanResult|undefined
        try {
          planResult=await planASL(text,context,true)
          const gloss=planResult.plan?.manual_sequence.map(step=>step.sign_id)||[]
          if(planResult.validation?.executable&&planResult.playback){
            const contextual=catalogMatches.some(clip=>clip.match_kind==='contextual')
            selected=[{
              phrase_id:`plan-${id}`,label:text,matched_text:text,
              validation_status:planResult.review_status==='reviewed'?'validated':'illustrative',
              animation_file:null,playback:planResult.playback,gloss,
              match_confidence:gate.confidence,
              match_threshold:catalogMatches.length
                ? Math.min(...catalogMatches.map(clip=>clip.match_threshold)) : 0,
              match_kind:catalogMatches.length?(contextual?'contextual':'exact'):'fallback',
              match_reason:catalogMatches.length?gate.reason
                :'No catalog match; rendered with labelled fingerspelling fallback.',
              rendering_source:catalogMatches.length?'catalog-plan':'fingerspelling-fallback',
            }]
          }
        } catch { /* Direct catalog clips remain available if planning is offline. */ }
        if(epoch!==generation.current)return
        setSegments(prev=>prev.map(segment=>segment.id===id
          ? {...segment,selected,catalogMatches,coverage:result.coverage,gate,planResult}
          : segment))
        enqueue(selected)
      } catch {
        if(epoch===generation.current)setSegments(prev=>prev.map(segment=>segment.id===id
          ? {...segment,coverage:'unsupported',planError:'Smart Sign Gate unavailable. Captions retained.'}
          : segment))
      }
    })
    await translationChain.current
  },[phrases,enqueue])

  const partialCb=useCallback((text:string)=>setPartial(text),[])
  const finalCb=useCallback((text:string)=>{void handleFinal(text,'microphone')},[handleFinal])
  const live=useLiveAudio({onPartial:partialCb,onFinal:finalCb})
  useEffect(()=>{void fetchHealth().then(setBackend);void fetchPhrases().then(setPhrases)},[])
  useEffect(()=>{
    if(playing||queue.length===0)return
    const [next,...rest]=queue
    setPlaying(next)
    setQueue(rest)
  },[queue,playing])
  useEffect(()=>{
    if(!playing||playing.playback)return
    const timer=setTimeout(()=>setPlaying(current=>current===playing?null:current),
      CLIP_LENGTH_MS[playing.phrase_id]||1600)
    return ()=>clearTimeout(timer)
  },[playing])

  const downloadTranscript=()=>{
    const content=['SIGN — lecture transcript','Prototype: animations are NOT verified ASL','',
      ...segments.map(segment=>`[${segment.timestamp.toLocaleTimeString()}] ${segment.text}`)].join('\n')
    const anchor=document.createElement('a')
    anchor.href=URL.createObjectURL(new Blob([content],{type:'text/plain'}))
    anchor.download=`sign-transcript-${new Date().toISOString().slice(0,10)}.txt`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }
  const startMic=async()=>{
    generation.current++
    recentContext.current=[]
    setQueue([])
    setPlaying(null)
    await live.start()
  }
  const handleAudioImport=async(file:File|null)=>{
    if(!file)return
    setFileError('');setImporting(true);setPartial(`Transcribing ${file.name}...`)
    try{
      const result=await transcribeAudio(file)
      setPartial('')
      await handleFinal(result.text,'text')
    }catch(err){
      setPartial('')
      setFileError(err instanceof Error?err.message:String(err))
    }finally{
      setImporting(false)
      if(fileInputRef.current)fileInputRef.current.value=''
    }
  }
  const latestSegment=segments.at(-1)
  const latestTranscript=latestSegment?.text
  const gloss=playing?.gloss||[]
  const compactGloss=gloss.length>4?`${gloss.slice(0,4).join(' · ')} · …`:gloss.join(' · ')
  const currentLabel=partial||latestTranscript||compactGloss||playing?.label||'Ready when you are'
  const stageMode=partial?'LIVE TRANSCRIPT':playing?'AVATAR / PLAYING':latestTranscript?'LATEST TRANSCRIPT':'AVATAR / STANDBY'
  const stageHint=partial?'Listening as words come in'
    :playing?.rendering_source==='fingerspelling-fallback'?'No catalog match · visible fingerspelling fallback'
    :playing?`${Math.round(playing.match_confidence*100)}% gate score · ${playing.validation_status==='validated'?'reviewed motion':'unverified motion'}`
    :latestSegment?.gate?.reason||'Type a sentence or start the microphone'
  const modeLabel=playing?.rendering_source==='fingerspelling-fallback'?'VISIBLE FALLBACK'
    :playing?.validation_status==='validated'?'REVIEWED MATCH'
    :playing?'SMART MATCH'
    :live.status==='listening'?'LISTENING':'READY'
  return <div className="page-content live-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> THE CLASSROOM</div><h1>Every word, within reach<span className="heading-period">.</span></h1><p>Live captions with context-checked signing and visible fallback playback.</p></div>
      <div className="heading-actions"><span className="privacy-pill"><span className="privacy-dot"/> No audio storage in Sign</span><button className="icon-button" title="Export transcript" onClick={downloadTranscript} disabled={!segments.length}><Download size={18}/></button></div>
    </div>
    <div className="live-layout">
      <section className="avatar-panel">
        <div className="panel-top"><span className="mini-heading"><Waves size={17}/> YOUR LIVE COMPANION</span><span className={live.status==='listening'?'mode-chip chip-live':'mode-chip'}>{live.status==='listening'&&!playing&&<span className="pulse-dot"/>}{modeLabel}</span></div>
        <div className="avatar-stage"><div className="orb orb-one"/><div className="orb orb-two"/>
          <Avatar clipId={playing?.phrase_id||'idle'} speed={1} timeline={playing?.playback} onComplete={()=>setPlaying(null)}/>
          <div className="stage-guidance"><span className="stage-index">{stageMode}</span><strong>{currentLabel}</strong><span>{stageHint}</span></div>
          <div className="stage-vertical">SIGN / 001</div>
        </div>
        <div className="playback-panel live-control-panel">
          <div className="live-control-mic">
            <button className={`mic-button ${live.status==='listening'?'mic-active':''}`} disabled={live.status==='connecting'||live.status==='stopping'} onClick={live.status==='listening'?live.stop:startMic}>{live.status==='listening'?<><Square size={15}/> Stop</>:<><Mic2 size={17}/> {live.status==='connecting'?'Connecting...':'Mic'}</>}</button>
            <input ref={fileInputRef} className="sr-only" type="file" accept="audio/*" onChange={e=>void handleAudioImport(e.target.files?.[0]||null)}/>
            <button className="secondary-button audio-import-button" disabled={importing} onClick={()=>fileInputRef.current?.click()}><FileAudio size={16}/> {importing?'Importing...':'Audio file'}</button>
          </div>
          <div className="live-control-text">
            {(live.error||fileError)&&<div className="inline-error"><CircleAlert size={15}/>{live.error||fileError}</div>}
            <div className="entry-row"><input value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){void handleFinal(draft,'text');setDraft('')}}} placeholder="Type a sentence for live interpretation..." aria-label="Type sample spoken text"/><button className="send-button" title="Add sentence to transcript" disabled={!draft.trim()} onClick={()=>{void handleFinal(draft,'text');setDraft('')}}><Send size={17}/></button></div>
            <div className="connection-hint"><span className={`small-dot ${backend?.live_configured?'green':'amber'}`}/>{backend?.live_configured?'Smart catalog, microphone, and audio import ready':backend?'Smart catalog ready · browser microphone fallback available':'Local catalog fallback available'}{backend?.catalog_backend?` · catalog: ${backend.catalog_backend}`:''}{live.connectedModel?` · ${live.connectedModel}`:''}</div>
          </div>
        </div>
        <div className="safety-inline"><CircleAlert size={15}/><span>Prototype gestures are not validated ASL and cannot replace a qualified interpreter.</span></div>
      </section>
    </div>
  </div>
}

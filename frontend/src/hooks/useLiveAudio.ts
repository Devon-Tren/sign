import { useCallback, useEffect, useRef, useState } from 'react'
import { liveWsUrl } from '../api'
import {createVoiceFilter,PCM_WORKLET} from '../audioProcessing'

type State='idle'|'connecting'|'listening'|'stopping'|'error'
type Callbacks={onPartial:(value:string)=>void;onFinal:(value:string)=>void}

type SpeechResult={isFinal:boolean;0:{transcript:string}}
type SpeechResultEvent={resultIndex:number;results:ArrayLike<SpeechResult>}
type SpeechErrorEvent={error:string;message?:string}
type BrowserSpeechRecognition={
  continuous:boolean
  interimResults:boolean
  lang:string
  onresult:((event:SpeechResultEvent)=>void)|null
  onerror:((event:SpeechErrorEvent)=>void)|null
  onend:(()=>void)|null
  start:()=>void
  stop:()=>void
  abort:()=>void
}
type SpeechRecognitionConstructor=new()=>BrowserSpeechRecognition

function browserSpeechRecognition():SpeechRecognitionConstructor|undefined{
  const speechWindow=window as typeof window&{
    SpeechRecognition?:SpeechRecognitionConstructor
    webkitSpeechRecognition?:SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition
}

export function useLiveAudio({onPartial,onFinal}:Callbacks){
  const [status,setStatus]=useState<State>('idle')
  const [error,setError]=useState('')
  const [connectedModel,setConnectedModel]=useState('')
  const [noiseFiltering,setNoiseFiltering]=useState('')
  const wsRef=useRef<WebSocket|null>(null),ctxRef=useRef<AudioContext|null>(null)
  const streamRef=useRef<MediaStream|null>(null),urlRef=useRef<string|null>(null)
  const recognitionRef=useRef<BrowserSpeechRecognition|null>(null)
  const recognitionActive=useRef(false)
  const callbacks=useRef({onPartial,onFinal})
  callbacks.current={onPartial,onFinal}
  const cleanup=useCallback(()=>{
    setNoiseFiltering('')
    recognitionActive.current=false
    if(recognitionRef.current){
      recognitionRef.current.onend=null
      recognitionRef.current.abort()
      recognitionRef.current=null
    }
    const ws=wsRef.current;wsRef.current=null
    if(ws && (ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING)) ws.close()
    streamRef.current?.getTracks().forEach(x=>x.stop());streamRef.current=null
    if(ctxRef.current&&ctxRef.current.state!=='closed')void ctxRef.current.close()
    ctxRef.current=null
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=null
  },[])
  useEffect(()=>()=>cleanup(),[cleanup])

  const startBrowserFallback=useCallback(()=>{
    const SpeechRecognition=browserSpeechRecognition()
    if(!SpeechRecognition)throw new Error('Live speech recognition needs an OpenAI API key or a browser with Speech Recognition support (such as Chrome or Edge).')
    const recognition=new SpeechRecognition()
    recognition.continuous=true
    recognition.interimResults=true
    recognition.lang='en-US'
    recognitionRef.current=recognition
    recognitionActive.current=true
    recognition.onresult=(event)=>{
      let interim=''
      for(let i=event.resultIndex;i<event.results.length;i++){
        const result=event.results[i]
        const text=result[0]?.transcript?.trim()||''
        if(!text)continue
        if(result.isFinal)callbacks.current.onFinal(text)
        else interim=`${interim} ${text}`.trim()
      }
      callbacks.current.onPartial(interim)
    }
    recognition.onerror=(event)=>{
      if(event.error==='no-speech')return
      const messages:Record<string,string>={
        'audio-capture':'No microphone was found.',
        'not-allowed':'Microphone permission was denied.',
        'network':'Browser speech recognition could not reach its transcription service.',
      }
      setError(messages[event.error]||event.message||`Speech recognition error: ${event.error}`)
      setStatus('error')
      recognitionActive.current=false
    }
    recognition.onend=()=>{
      if(!recognitionActive.current)return
      // Browser recognition may end after a quiet period. Restart while the user
      // still has the microphone enabled so lectures continue transcribing.
      try{recognition.start()}catch{
        recognitionActive.current=false
        setStatus('idle')
      }
    }
    recognition.start()
    setConnectedModel('Browser speech recognition')
    setNoiseFiltering('Browser-managed mic filtering')
    setStatus('listening')
  },[])

  const start=useCallback(async()=>{
    cleanup();setError('');setConnectedModel('');setStatus('connecting')
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access requires localhost or HTTPS and a compatible browser.')
      const ws=new WebSocket(liveWsUrl())
      wsRef.current=ws
      // Wait for backend + authenticated upstream handshake BEFORE asking for mic permission.
      try{await new Promise<void>((resolve,reject)=>{
        let ready=false
        const timer=setTimeout(()=>reject(new Error('Transcription handshake timed out. Check backend/.env and server logs.')),12000)
        ws.onerror=()=>{clearTimeout(timer);reject(new Error('Unable to reach the live transcription server.'))}
        ws.onmessage=(evt)=>{
          let m: {type:string;message?:string;model?:string;text?:string}
          try{m=JSON.parse(evt.data)}catch{return}
          if(m.type==='connected'){ready=true;clearTimeout(timer);setConnectedModel(m.model||'');resolve()}
          else if(m.type==='error'){
            const message=m.message||'Live transcription error'
            setError(message);setStatus('error')
            if(!ready){clearTimeout(timer);reject(new Error(message))}
            else cleanup()
          }
          else if(m.type==='partial')callbacks.current.onPartial(m.text||'')
          else if(m.type==='final')callbacks.current.onFinal(m.text||'')
        }
        ws.onclose=(evt)=>{
          if(!ready){clearTimeout(timer);reject(new Error('Transcription server closed before connecting.'))}
          else if(evt.code!==1000){setStatus(prev=>prev==='stopping'||prev==='idle'?prev:'error');setError(prev=>prev||'Transcription stream closed.')}
        }
      })}catch{
        cleanup()
        setError('')
        startBrowserFallback()
        return
      }
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:{ideal:1}},video:false})
      streamRef.current=stream
      const ctx=new AudioContext();ctxRef.current=ctx
      const blobUrl=URL.createObjectURL(new Blob([PCM_WORKLET],{type:'text/javascript'}));urlRef.current=blobUrl
      await ctx.audioWorklet.addModule(blobUrl)
      const source=ctx.createMediaStreamSource(stream)
      const node=new AudioWorkletNode(ctx,'sign-pcm-stream')
      node.port.onmessage=(event:MessageEvent<ArrayBuffer>)=>{
        if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<500_000)ws.send(event.data)
      }
      const mute=ctx.createGain();mute.gain.value=0
      const filter=createVoiceFilter(ctx)
      source.connect(filter.input);filter.output.connect(node).connect(mute).connect(ctx.destination)
      if(ctx.state==='suspended')await ctx.resume()
      setNoiseFiltering('Mic noise filter on')
      setStatus('listening')
    }catch(err){cleanup();setError(err instanceof Error?err.message:String(err));setStatus('error')}
  },[cleanup,startBrowserFallback])
  const stop=useCallback(()=>{
    setStatus('stopping')
    if(recognitionRef.current){
      recognitionActive.current=false
      callbacks.current.onPartial('')
      recognitionRef.current.stop()
      recognitionRef.current=null
      setNoiseFiltering('')
      setStatus('idle')
      return
    }
    const ws=wsRef.current
    if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'flush'}))
    streamRef.current?.getTracks().forEach(track=>track.stop())
    if(ctxRef.current?.state!=='closed')void ctxRef.current?.close()
    // Leave socket open briefly so the last committed transcript can arrive.
    setTimeout(()=>{cleanup();setStatus('idle')},1500)
  },[cleanup])
  return {status,error,connectedModel,noiseFiltering,start,stop}
}

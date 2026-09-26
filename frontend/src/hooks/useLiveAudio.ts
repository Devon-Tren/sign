import { useCallback, useEffect, useRef, useState } from 'react'
import { liveWsUrl } from '../api'

type State='idle'|'connecting'|'listening'|'stopping'|'error'
type Callbacks={onPartial:(value:string)=>void;onFinal:(value:string)=>void}

// AudioWorklet resamples the actual AudioContext clock to the API's 24 kHz PCM16 format.
// Silence is preserved so the backend's simple energy VAD can segment speech.
const WORKLET=`class PCMStream extends AudioWorkletProcessor {
 constructor(){super();this.buffer=[];this.position=0;this.out=[];this.step=sampleRate/24000;}
 process(inputs){
   const input=inputs[0]&&inputs[0][0]; if(!input)return true;
   for(let i=0;i<input.length;i++)this.buffer.push(input[i]);
   while(this.position+1<this.buffer.length){
     const i=Math.floor(this.position),f=this.position-i;
     this.out.push(this.buffer[i]*(1-f)+this.buffer[i+1]*f);
     this.position+=this.step;
     if(this.out.length>=2400){
       const data=new Int16Array(this.out.length);
       for(let j=0;j<this.out.length;j++){const v=Math.max(-1,Math.min(1,this.out[j]));data[j]=v<0?v*32768:v*32767;}
       this.port.postMessage(data.buffer,[data.buffer]);this.out=[];
     }
   }
   const consumed=Math.floor(this.position);
   if(consumed){this.buffer.splice(0,consumed);this.position-=consumed;}
   return true;
 }
}
registerProcessor('sign-pcm-stream',PCMStream);`

export function useLiveAudio({onPartial,onFinal}:Callbacks){
  const [status,setStatus]=useState<State>('idle')
  const [error,setError]=useState('')
  const [connectedModel,setConnectedModel]=useState('')
  const wsRef=useRef<WebSocket|null>(null),ctxRef=useRef<AudioContext|null>(null)
  const streamRef=useRef<MediaStream|null>(null),urlRef=useRef<string|null>(null)
  const callbacks=useRef({onPartial,onFinal})
  callbacks.current={onPartial,onFinal}
  const cleanup=useCallback(()=>{
    const ws=wsRef.current;wsRef.current=null
    if(ws && (ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING)) ws.close()
    streamRef.current?.getTracks().forEach(x=>x.stop());streamRef.current=null
    if(ctxRef.current&&ctxRef.current.state!=='closed')void ctxRef.current.close()
    ctxRef.current=null
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=null
  },[])
  useEffect(()=>()=>cleanup(),[cleanup])

  const start=useCallback(async()=>{
    cleanup();setError('');setConnectedModel('');setStatus('connecting')
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access requires localhost or HTTPS and a compatible browser.')
      const ws=new WebSocket(liveWsUrl())
      wsRef.current=ws
      // Wait for backend + authenticated upstream handshake BEFORE asking for mic permission.
      await new Promise<void>((resolve,reject)=>{
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
      })
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})
      streamRef.current=stream
      const ctx=new AudioContext();ctxRef.current=ctx
      const blobUrl=URL.createObjectURL(new Blob([WORKLET],{type:'text/javascript'}));urlRef.current=blobUrl
      await ctx.audioWorklet.addModule(blobUrl)
      const source=ctx.createMediaStreamSource(stream)
      const node=new AudioWorkletNode(ctx,'sign-pcm-stream')
      node.port.onmessage=(event:MessageEvent<ArrayBuffer>)=>{
        if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<500_000)ws.send(event.data)
      }
      const mute=ctx.createGain();mute.gain.value=0
      source.connect(node).connect(mute).connect(ctx.destination)
      if(ctx.state==='suspended')await ctx.resume()
      setStatus('listening')
    }catch(err){cleanup();setError(err instanceof Error?err.message:String(err));setStatus('error')}
  },[cleanup])
  const stop=useCallback(()=>{
    setStatus('stopping')
    const ws=wsRef.current
    if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'flush'}))
    streamRef.current?.getTracks().forEach(track=>track.stop())
    if(ctxRef.current?.state!=='closed')void ctxRef.current?.close()
    // Leave socket open briefly so the last committed transcript can arrive.
    setTimeout(()=>{cleanup();setStatus('idle')},1500)
  },[cleanup])
  return {status,error,connectedModel,start,stop}
}

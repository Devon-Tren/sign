import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {PCM_WORKLET} from '../src/audioProcessing'

function processAudio(rate:number,signal:(t:number)=>number,seconds=1){
 const chunks:Int16Array[]=[]
 let Processor:any
 class Base {port={postMessage:(data:ArrayBuffer)=>chunks.push(new Int16Array(data))}}
 vm.runInNewContext(PCM_WORKLET,{AudioWorkletProcessor:Base,sampleRate:rate,registerProcessor:(_name:string,p:any)=>{Processor=p},Int16Array,Math})
 const processor=new Processor()
 for(let i=0;i<rate*seconds;i+=128){const block=Float32Array.from({length:Math.min(128,rate*seconds-i)},(_,j)=>signal((i+j)/rate));processor.process([[block]])}
 return chunks.flatMap(c=>Array.from(c))
}
const rms=(values:number[])=>Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length)/32768

test('quiet background is attenuated without dropping time or hard gating',()=>{
 const data=processAudio(48000,t=>.0004*Math.sin(2*Math.PI*1000*t),2)
 assert.ok(data.length>=45600)
 const quiet=rms(data.slice(-12000))
 assert.ok(quiet<.00016,`quiet RMS ${quiet}`)
 assert.ok(quiet>0,'quiet audio is attenuated, not gated to zero')
})
test('speech-level signal stays intact and opens quickly after silence',()=>{
 const data=processAudio(48000,t=>t<.5?0:.1*Math.sin(2*Math.PI*1000*t),1)
 assert.ok(Math.abs(rms(data.slice(13200,18000))-.1/Math.sqrt(2))<.001)
 assert.ok(rms(data.slice(12120,12480))>.05,'first speech recovers within milliseconds')
})
test('PCM remains 24kHz mono with silence, clipping protection and varied input clocks',()=>{
 for(const rate of [24000,44100,48000]){
  const silence=processAudio(rate,()=>0)
  // A final partial 100ms packet stays buffered; floating-point resampling
  // can put the last sample on either side of that packet boundary.
  assert.ok(silence.length>=21600&&silence.length<=24000)
  assert.equal(silence.length%2400,0)
  assert.ok(silence.every(v=>v===0))
  const loud=processAudio(rate,()=>2)
  assert.ok(loud.every(v=>v===32767))
 }
})

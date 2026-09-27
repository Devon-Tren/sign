/** Local voice cleanup, in addition to getUserMedia noise suppression. */
export const VOICE_FILTER = { highpassHz: 85, lowpassHz: 8000 }

export function createVoiceFilter(context: BaseAudioContext) {
  const highpass=context.createBiquadFilter()
  highpass.type='highpass';highpass.frequency.value=VOICE_FILTER.highpassHz;highpass.Q.value=.707
  const lowpass=context.createBiquadFilter()
  lowpass.type='lowpass';lowpass.frequency.value=Math.min(VOICE_FILTER.lowpassHz,context.sampleRate*.45);lowpass.Q.value=.707
  highpass.connect(lowpass)
  return {input:highpass,output:lowpass}
}

// AudioWorklet resamples the actual AudioContext clock to the API's 24 kHz PCM16 format.
// Silence is preserved so the backend's simple energy VAD can segment speech.
export const PCM_WORKLET=`class PCMStream extends AudioWorkletProcessor {
 constructor(){super();this.buffer=[];this.position=0;this.out=[];this.step=sampleRate/24000;this.gain=1;}
 process(inputs){
   const input=inputs[0]&&inputs[0][0]; if(!input)return true;
   // Soft expansion only below quiet speech levels; never hard-gate syllables.
   let energy=0;for(let i=0;i<input.length;i++)energy+=input[i]*input[i];
   const rms=Math.sqrt(energy/input.length);
   const level=Math.max(0,Math.min(1,(rms-0.0004)/0.0021));
   const target=0.35+0.65*level;
   const rate=1-Math.exp(-1/(sampleRate*(target>this.gain?0.004:0.18)));
   for(let i=0;i<input.length;i++){
     this.gain+=(target-this.gain)*rate;
     this.buffer.push(input[i]*this.gain);
   }
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


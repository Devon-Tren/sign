/**
 * Procedural placeholder poses — these ARE NOT validated ASL clips.
 * Replace with Deaf-signer-reviewed glTF skeletal animations and facial blendshapes.
 */
export type ClipId = 'idle'|'hello'|'thank_you'|'yes'|'no'|'help'|'good_morning'|'question'|'learn'|'understand'|'today'|'artificial_intelligence'|'computer'
export type Pose = { left:number, right:number, leftElbow:number, rightElbow:number, leftHand:number, rightHand:number, head:number, torso:number, shape:'open'|'fist'|'index', mouth?:number }
export const CLIP_LENGTH_MS:Record<string,number> = {
  idle:1600,hello:1750,thank_you:1650,yes:1450,no:1400,help:1950,good_morning:2050,
  question:1850,learn:1750,understand:1400,today:1650,artificial_intelligence:2350,computer:1850,
}
export function motionFor(id:string, t:number):Pose {
  const w=Math.sin(t*6), swing=Math.sin(t*4)
  switch(id) {
    case 'hello': return {left:-.22,right:2.55+ w*.20,leftElbow:0,rightElbow:-.24,rightHand:w*.32,leftHand:0,head:0,torso:0,shape:'open',mouth:.1}
    case 'thank_you': return {left:-.14,right:2.06,leftElbow:0,rightElbow:-.63+swing*.2,rightHand:0,leftHand:0,head:-.05,torso:.05,shape:'open'}
    case 'yes': return {left:-.1,right:1.9,leftElbow:0,rightElbow:.40+swing*.18,rightHand:0,leftHand:0,head:Math.sin(t*4)*.06,torso:0,shape:'fist'}
    case 'no': return {left:-.1,right:2,leftElbow:0,rightElbow:.20,rightHand:swing*.3,leftHand:0,head:Math.sin(t*4)*.09,torso:0,shape:'index'}
    case 'help': return {left:-1.38,right:1.35,leftElbow:-.35,rightElbow:.35,rightHand:swing*.10,leftHand:0,head:0,torso:0,shape:'open'}
    case 'good_morning': return {left:-.5,right:2.18,leftElbow:0,rightElbow:-.2,rightHand:swing*.16,leftHand:0,head:.04,torso:0,shape:'open'}
    case 'question': return {left:-.1,right:2.35,leftElbow:0,rightElbow:-.75+swing*.16,rightHand:swing*.16,leftHand:0,head:-.14,torso:.02,shape:'index'}
    case 'learn': return {left:-1.1,right:1.38,leftElbow:-.55,rightElbow:.31+swing*.2,rightHand:0,leftHand:0,head:0,torso:0,shape:'open'}
    case 'understand': return {left:-.1,right:2.2,leftElbow:0,rightElbow:-.45,rightHand:swing*.1,leftHand:0,head:Math.sin(t*4)*.02,torso:0,shape:'index'}
    case 'today': return {left:-1.45,right:1.45,leftElbow:.25+swing*.07,rightElbow:-.25-swing*.07,rightHand:0,leftHand:0,head:0,torso:0,shape:'open'}
    case 'artificial_intelligence': return {left:-1.85,right:1.85,leftElbow:.45+swing*.28,rightElbow:-.45-swing*.28,rightHand:swing*.12,leftHand:-swing*.12,head:-.08,torso:Math.sin(t*2)*.03,shape:'index'}
    case 'computer': return {left:-1.13,right:1.30,leftElbow:-.4,rightElbow:-.35+swing*.22,rightHand:0,leftHand:0,head:0,torso:0,shape:'open'}
    default: return {left:-.1,right:.1,leftElbow:0,rightElbow:0,leftHand:0,rightHand:0,head:0,torso:0,shape:'open'}
  }
}

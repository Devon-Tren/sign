/** Ordered, body-relative practice checks. These are coaching rubrics, not ASL recognition. */
export type Point = {x:number;y:number;z:number;visibility?:number}
export type Side = 'Right'|'Left'
export type Shape = 'open'|'fist'|'index'|'h'|'curve'
export type TrackedHand = {points:Point[];world:Point[];side:Side;confidence:number}
export type HandFeatures = {shape:Shape|null;center:Point;tip:Point;axis:Point;palm:Point;thumbUp:boolean}
export type Observation = {valid:boolean;reason:string;dominant?:HandFeatures;support?:HandFeatures;noseY:number}
export type Check = {name:string;passed:boolean;detail:string}
export type Grade = {score:number;matched:boolean;observed:string;expected:string;tip:string;qualityChecks:Check[];progress:number}
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z})
const length=(a:Point)=>Math.hypot(a.x,a.y,a.z)
const unit=(a:Point):Point=>{const n=length(a);return {x:a.x/(n||1),y:a.y/(n||1),z:a.z/(n||1)}}
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y+a.z*b.z
const cross=(a:Point,b:Point):Point=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x})
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y)
const finite=(p:Point)=>p&&[p.x,p.y,p.z].every(Number.isFinite)
function angle(a:Point,b:Point,c:Point){return Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(a,b)),unit(sub(c,b))))))*180/Math.PI}
export function classifyShape(points:Point[]):Shape|null{
  if(points.length!==21||!points.every(finite))return null
  // Check both finger joints. Ambiguous half-curled fingers never count as a fist.
  const bends=[5,9,13,17].map(i=>Math.min(angle(points[i],points[i+1],points[i+2]),angle(points[i+1],points[i+2],points[i+3])))
  const straight=bends.map(a=>a>=155),curled=bends.map(a=>a<=115)
  if(straight.every(Boolean))return 'open'
  if(curled.every(Boolean))return 'fist'
  if(straight[0]&&curled.slice(1).every(Boolean))return 'index'
  if(straight[0]&&straight[1]&&curled[2]&&curled[3])return 'h'
  if(bends.every(a=>a>115&&a<155))return 'curve'
  return null
}

export function observe(hands:TrackedHand[],pose:Point[],side:Side,aspect:number,needsBody:boolean,needsSupport=false):Observation{
  const invalid=(reason:string):Observation=>({valid:false,reason,noseY:0})
  const bodyIds=[0,7,8,11,12]
  const bodyOk=bodyIds.every(i=>finite(pose[i])&&(pose[i].visibility??0)>=.7)
  if(needsBody&&!bodyOk)return invalid('Keep your head and both shoulders clearly visible.')
  const shoulder=bodyOk?{x:(pose[11].x+pose[12].x)/2,y:(pose[11].y+pose[12].y)/2,z:0}:{x:.5,y:.5,z:0}
  // Normalize x and y to the same units before measuring shoulder width.
  const scale=bodyOk?Math.hypot((pose[11].x-pose[12].x)*aspect,pose[11].y-pose[12].y):.4
  if(!Number.isFinite(aspect)||aspect<=0||scale<.12)return invalid('Face the camera with both shoulders in view.')
  const relative=(p:Point):Point=>({x:(p.x-shoulder.x)*aspect/scale,y:(p.y-shoulder.y)/scale,z:0})
  const result:Observation={valid:true,reason:'Tracking is clear',noseY:bodyOk?relative(pose[0]).y:0}
  if(!hands.length)return invalid('Keep the required hands visible.')
  const seen=new Set<Side>()
  for(const hand of hands.filter(hand=>needsSupport||hand.side===side)){
    if(!Number.isFinite(hand.confidence)||!['Left','Right'].includes(hand.side)||hand.confidence<.8||seen.has(hand.side)||hand.points.length!==21||hand.world.length!==21||!hand.points.every(finite)||!hand.world.every(finite))return invalid('Hand tracking is uncertain. Separate your hands and try again.')
    seen.add(hand.side)
    if(!hand.points.every(p=>p.x>.025&&p.x<.975&&p.y>.025&&p.y<.975))return invalid('Keep the whole hand away from the edge of the frame.')
    const p=hand.world, image=hand.points
    const palmSize=length(sub(p[9],p[0]))
    if(palmSize<.025||palmSize>.16||distance({x:image[0].x*aspect,y:image[0].y,z:0},{x:image[9].x*aspect,y:image[9].y,z:0})<.035)return invalid('Move closer so the hand can be measured clearly.')
    // MediaPipe handedness is for the unmirrored input. The preview alone is mirrored.
    const normal=unit(cross(sub(p[5],p[0]),sub(p[17],p[0])))
    const sign=hand.side==='Right'?-1:1
    const features:HandFeatures={shape:classifyShape(p),center:relative(image[9]),tip:relative(image[8]),axis:unit(sub(p[8],p[5])),palm:{x:normal.x*sign,y:normal.y*sign,z:normal.z*sign},thumbUp:p[4].y<p[2].y-palmSize*.25&&length(sub(p[4],p[5]))>palmSize*.5}
    if(hand.side===side)result.dominant=features;else result.support=features
  }
  if(needsSupport&&!result.support)return invalid('Keep both hands clearly visible throughout the sign.')
  if(!result.dominant)return invalid(`Keep your ${side.toLowerCase()} signing hand visible.`)
  return result
}

type Step={label:string;test:(o:Observation,start:Observation,previous:Observation)=>boolean}
type Rubric={steps:Step[];holdMs:number;body:boolean;twoHands?:boolean}
const d=(o:Observation)=>o.dominant!
const s=(o:Observation)=>o.support
const shape=(o:Observation,value:Shape)=>d(o).shape===value
const front=(o:Observation)=>d(o).palm.z>.45
const inward=(o:Observation)=>d(o).palm.z<-.35
const head=(o:Observation)=>Math.abs(d(o).center.y-o.noseY)<.4&&Math.abs(d(o).center.x)>.12&&Math.abs(d(o).center.x)<.85
const chest=(o:Observation)=>Math.abs(d(o).center.x)<.45&&d(o).center.y>-.1&&d(o).center.y<.65
const step=(label:string,test:Step['test']):Step=>({label,test})
const supportPalm=(o:Observation)=>!!s(o)&&s(o)!.shape==='open'&&s(o)!.palm.y<-.4&&Math.abs(s(o)!.center.x)<.6&&s(o)!.center.y>0&&s(o)!.center.y<.9
const gap=(o:Observation)=>d(o).center.y-s(o)!.center.y
const above=(o:Observation)=>supportPalm(o)&&gap(o)<-.22&&gap(o)>-.65&&Math.abs(d(o).center.x-s(o)!.center.x)<.3
const contact=(o:Observation)=>supportPalm(o)&&Math.abs(gap(o))<.14&&Math.abs(d(o).center.x-s(o)!.center.x)<.24
const tapContact=(o:Observation,hand:Shape)=>hand==='curve'?supportPalm(o)&&distance(d(o).tip,s(o)!.center)<.18:contact(o)
const tapAbove=(o:Observation,hand:Shape)=>hand==='curve'?supportPalm(o)&&d(o).tip.y<s(o)!.center.y-.22&&d(o).tip.y>s(o)!.center.y-.65&&Math.abs(d(o).tip.x-s(o)!.center.x)<.3:above(o)
const taps=(hand:Shape,thumb=false):Step[]=>[false,true,false,true].map((touch,i)=>step(`${touch?'Tap':'Lift above'} the support palm${i>0?' again':''}`,o=>shape(o,hand)&&(!thumb||d(o).thumbUp)&&(touch?tapContact(o,hand):tapAbove(o,hand))))
const fingerChanges=(question:boolean):Step[]=>[false,true,false,true,false].map((extended,i)=>step(`${extended?'Extend':'Curl'} the index${i>1?' again':''}`,o=>head(o)&&shape(o,extended?'index':'fist')&&(question?front(o):inward(o))))
export const RUBRICS:Record<string,Rubric>={
 open:{body:false,holdMs:1200,steps:[step('Hold four straight fingers with the palm facing the camera',o=>shape(o,'open')&&front(o))]},
 fist:{body:false,holdMs:1200,steps:[step('Hold all four fingers fully curled',o=>shape(o,'fist')&&front(o))]},
 index:{body:false,holdMs:1200,steps:[step('Hold the index straight with the other fingers curled',o=>shape(o,'index')&&front(o))]},
 'two-open':{body:true,twoHands:true,holdMs:1200,steps:[step('Raise both open palms up and outward',o=>shape(o,'open')&&front(o)&&s(o)?.shape==='open'&&s(o)!.palm.z>.45&&d(o).center.y<0&&s(o)!.center.y<0&&d(o).center.x*s(o)!.center.x<0&&Math.abs(d(o).center.x)>.55&&Math.abs(s(o)!.center.x)>.55)]},
 hello:{body:true,holdMs:180,steps:[step('Start with an open hand at the brow, palm forward',o=>shape(o,'open')&&front(o)&&Math.abs(d(o).tip.y-(o.noseY-.23))<.22&&Math.abs(d(o).tip.x)>.1&&Math.abs(d(o).tip.x)<.65),step('Move the same open hand outward from the brow',(o,a)=>shape(o,'open')&&front(o)&&Math.abs(d(o).center.x)>Math.abs(d(a).center.x)+.25&&Math.abs(d(o).center.y-d(a).center.y)<.3)]},
 thank_you:{body:true,holdMs:180,steps:[step('Place open fingertips at the chin, palm toward you',o=>shape(o,'open')&&inward(o)&&Math.abs(d(o).tip.x)<.28&&Math.abs(d(o).tip.y-(o.noseY+.2))<.2),step('Lower the open hand, keeping the palm toward you',(o,a)=>shape(o,'open')&&inward(o)&&d(o).center.y>d(a).center.y+.25&&Math.abs(d(o).center.x-d(a).center.x)<.2)]},
 please:{body:true,holdMs:140,steps:[step('Start a flat palm at the chest',o=>shape(o,'open')&&chest(o)&&inward(o)),...[[.15,0],[0,.15],[-.15,0],[0,-.15],[.15,0]].map(([x,y],i)=>step(`Trace chest circle, part ${i+1}`,(o,a)=>shape(o,'open')&&inward(o)&&chest(o)&&Math.abs(d(o).center.x-d(a).center.x-x)<.1&&Math.abs(d(o).center.y-d(a).center.y-y)<.1))]},
 me:{body:true,holdMs:220,steps:[step('Prepare an index point just in front of the chest',o=>shape(o,'index')&&chest(o)&&distance(d(o).tip,{x:0,y:.2,z:0})>.25),step('Point the index inward at your chest',(o,a)=>shape(o,'index')&&distance(d(o).tip,{x:0,y:.2,z:0})<.2&&distance(d(o).tip,d(a).tip)>.13&&d(o).axis.z>.2)]},
 you:{body:true,holdMs:220,steps:[step('Start an index hand in neutral signing space',o=>shape(o,'index')&&chest(o)&&d(o).axis.z>-.3),step('Point the index toward the camera',o=>shape(o,'index')&&chest(o)&&d(o).axis.z<-.65)]},
 name:{body:true,twoHands:true,holdMs:180,steps:[false,true,false,true].map(touch=>step(touch?'Cross the two H hands at roughly a right angle':'Separate the two H hands',o=>shape(o,'h')&&s(o)?.shape==='h'&&chest(o)&&Math.abs(dot(d(o).axis,s(o)!.axis))<.35&&(touch?distance(d(o).tip,s(o)!.tip)<.22:distance(d(o).tip,s(o)!.tip)>.32)))},
 help:{body:true,twoHands:true,holdMs:180,steps:taps('fist',true)},
 again:{body:true,twoHands:true,holdMs:180,steps:taps('curve')},
 understand:{body:true,holdMs:180,steps:fingerChanges(false).slice(0,4).map((entry,i)=>i%2===0?entry:step('Raise the index with a slight nod',(o,a,p)=>entry.test(o,a,p)&&o.noseY>a.noseY+.025))},
 question:{body:true,holdMs:180,steps:[step('Raise the extended index beside the head, palm forward',o=>head(o)&&shape(o,'index')&&front(o)),...fingerChanges(true).slice(0,4)]},
}
export const GRADING_VERSION='sign-practice-completion-v2'
export const rubricFor=(id:string)=>RUBRICS[id]

/** Progress is earned by consecutive evidence, never by a best frame. */
export class PracticeAttempt{
 private index=0;private since:number|null=null;private count=0;private last=-Infinity;private lastGood=-Infinity
 private holdObservation:Observation|null=null;private lastStep=-Infinity
 private start:Observation|null=null;private previous:Observation|null=null;private lastObservation:Observation|null=null
 private check:Check={name:'Tracking',passed:false,detail:'Show the required hands.'}
 constructor(readonly id:string){}
 update(o:Observation,now:number):Grade{
  const rubric=rubricFor(this.id)
  if(!rubric)return this.result('No grading criteria are available for this item.')
  if(!Number.isFinite(now)||now<=this.last)return this.result()
  if(now-this.last>450||!o.valid){this.since=null;this.count=0}
  if(now-this.lastGood>900||(this.index>0&&now-this.lastStep>2400)){this.index=0;this.start=null;this.previous=null;this.holdObservation=null}
  this.last=now
  if(!o.valid){this.check={name:'Tracking',passed:false,detail:o.reason};return this.result()}
  if(!o.dominant){this.check={name:'Tracking',passed:false,detail:'Signing hand missing'};return this.result()}
  // Reject discontinuities rather than interpreting tracker jumps as sign movement.
  if(this.lastObservation?.dominant&&now-this.lastGood<450&&distance(d(o).center,d(this.lastObservation).center)>.65){this.index=0;this.start=null;this.previous=null;this.since=null;this.count=0;this.lastObservation=o;this.lastGood=now;this.check={name:'Continuity',passed:false,detail:'Move smoothly and keep your signing hand visible.'};return this.result()}
  this.lastObservation=o;this.lastGood=now
  const current=rubric.steps[this.index]
  if(!current)return this.result()
  const passed=current.test(o,this.start??o,this.previous??o)
  this.check={name:current.label,passed,detail:current.label}
  if(!passed){this.since=null;this.count=0;return this.result()}
  if(this.since===null||!this.holdObservation||(distance(d(o).center,d(this.holdObservation).center)>.12||(o.support&&this.holdObservation.support&&distance(o.support.center,this.holdObservation.support.center)>.12))){this.since=now;this.count=0;this.holdObservation=o}
  this.count++
  if(now-this.since>=rubric.holdMs&&this.count>=3){
   this.start??=o;this.previous=o;this.index++;this.lastStep=now;this.since=null;this.count=0;this.holdObservation=null
  }
  return this.result()
 }
 result(message?:string):Grade{
  const r=rubricFor(this.id),total=r?.steps.length??1,matched=!!r&&this.index===total
  const progress=this.index/total
  const tip=message??(matched?'All measured steps matched in order.':this.check.passed?r?.steps[this.index]?.label??this.check.detail:this.check.detail)
  return {score:matched?100:Math.min(89,Math.round(progress*90)),matched,progress,observed:matched?'Complete measured sequence':`${this.index} of ${total} steps matched. ${tip}`,expected:r?.steps.map(s=>s.label).join('; ')??'No rubric',tip:tip??'Keep practicing.',qualityChecks:r?.steps.map((s,i)=>({name:s.label,passed:i<this.index,detail:s.label}))??[]}
 }
}

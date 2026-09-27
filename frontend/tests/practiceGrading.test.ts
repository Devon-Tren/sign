import assert from 'node:assert/strict'
import test from 'node:test'
import {LEARNING_ITEMS} from '../src/learning'
import {PracticeAttempt,RUBRICS,observe,classifyShape,GRADING_VERSION,type HandFeatures,type Observation,type Point,type TrackedHand} from '../src/practiceGrading'

const point=(x=0,y=0,z=0):Point=>({x,y,z})
const hand=(patch:Partial<HandFeatures>={}):HandFeatures=>({shape:'open',center:point(.3,.2),tip:point(.3,-.2),axis:point(0,-1),palm:point(0,0,1),thumbUp:false,...patch})
const observation=(patch:Partial<HandFeatures>={},support?:HandFeatures,noseY=-.7):Observation=>({valid:true,reason:'Tracked',dominant:hand(patch),support,noseY})
const inward=point(0,0,-1),support=hand({center:point(0,.6),palm:point(0,-1)})
const sequences:Record<string,Observation[]>={
 open:[observation()],fist:[observation({shape:'fist'})],index:[observation({shape:'index'})],
 'two-open':[observation({center:point(.7,-.2)},hand({center:point(-.7,-.2)}))],
 hello:[observation({center:point(.4,-.55),tip:point(.3,-.9)}),observation({center:point(.72,-.54)})],
 thank_you:[observation({center:point(.1,-.2),tip:point(.05,-.48),palm:inward}),observation({center:point(.1,.1),palm:inward})],
 please:[observation({center:point(0,.22),palm:inward}),...[[.16,.22],[0,.38],[-.16,.22],[0,.06],[.16,.22]].map(([x,y])=>observation({center:point(x,y),palm:inward}))],
 me:[observation({shape:'index',tip:point(.33,.2)}),observation({shape:'index',tip:point(.06,.2),axis:point(-.3,0,.8)})],
 you:[observation({shape:'index'}),observation({shape:'index',axis:point(0,0,-1)})],
 name:[false,true,false,true].map(touch=>observation({shape:'h',tip:point(touch?.1:.4,.2),axis:point(1,0)},hand({shape:'h',tip:point(0,.2),axis:point(0,-1)}))),
 help:[false,true,false,true].map(touch=>observation({shape:'fist',thumbUp:true,center:point(0,touch?.52:.2)},support)),
 again:[false,true,false,true].map(touch=>observation({shape:'curve',center:point(0,.2),tip:point(0,touch?.57:.28)},support)),
 understand:[false,true,false,true].map(up=>observation({shape:up?'index':'fist',center:point(.4,-.7),palm:inward},undefined,up?-.64:-.7)),
 question:[true,false,true,false,true].map(up=>observation({shape:up?'index':'fist',center:point(.4,-.7)})),
}
function run(id:string,frames:Observation[]){
 const attempt=new PracticeAttempt(id);let now=0
 for(const frame of frames){for(let i=0;i<(RUBRICS[id].holdMs===1200?14:4);i++){attempt.update(frame,now);now+=100}}
 return attempt.result()
}

test('every Learn item has its own rubric and displayed steps',()=>{
 assert.deepEqual(Object.keys(RUBRICS).sort(),LEARNING_ITEMS.map(i=>i.id).sort())
 for(const item of LEARNING_ITEMS){assert.ok(item.practice.enabled);assert.deepEqual(item.instructions,RUBRICS[item.id].steps.map(s=>s.label))}
 assert.notEqual(GRADING_VERSION,'sign-drill-completion-v1')
})
for(const id of Object.keys(sequences)){
 test(`${id}: a complete ordered example passes`,()=>assert.equal(run(id,sequences[id]).matched,true))
 test(`${id}: unrelated motion never earns full credit`,()=>{
  const wrong=Array.from({length:25},(_,i)=>observation({shape:i%2?'fist':'open',center:point(-.9,.9),palm:point(1,0)}))
  assert.ok(run(id,wrong).score<90);assert.equal(run(id,wrong).matched,false)
 })
 if(sequences[id].length>1)test(`${id}: static final pose and missing first step cannot pass`,()=>{
  assert.equal(run(id,Array(8).fill(sequences[id].at(-1))).matched,false)
  assert.equal(run(id,sequences[id].slice(1)).matched,false)
 })
}
test('brief perfect frame, intermittent matches, and duplicate timestamps earn no completion',()=>{
 const a=new PracticeAttempt('open'),good=observation(),bad=observation({shape:'fist'})
 for(let t=0;t<3000;t+=100)a.update(t%300?bad:good,t)
 assert.equal(a.result().score,0)
 for(let i=0;i<30;i++)a.update(good,3000)
 assert.equal(a.result().matched,false)
})
test('tracking loss clears the sequence and wrong order cannot be stitched across attempts',()=>{
 const a=new PracticeAttempt('hello')
 for(let t=0;t<=300;t+=100)a.update(sequences.hello[0],t)
 assert.ok(a.result().score>0)
 a.update({valid:false,reason:'Lost',noseY:0},1400)
 for(let t=1500;t<2000;t+=100)a.update(sequences.hello[1],t)
 assert.equal(a.result().matched,false)
 assert.equal(new PracticeAttempt('hello').result().score,0)
})
test('holding the wrong handshape between phases expires progress',()=>{
 const a=new PracticeAttempt('hello')
 for(let t=0;t<300;t+=100)a.update(sequences.hello[0],t)
 for(let t=300;t<4000;t+=100)a.update(observation({shape:'fist'}),t)
 assert.equal(a.result().score,0)
})
test('two-hand phrases require the support shape and position throughout',()=>{
 for(const id of ['two-open','name','help','again']){
  assert.equal(run(id,sequences[id].map(o=>({...o,support:undefined}))).matched,false)
  assert.equal(run(id,sequences[id].map(o=>({...o,support:hand({shape:'fist'})}))).matched,false)
 }
 assert.equal(run('help',sequences.help.map(o=>({...o,dominant:{...o.dominant!,thumbUp:false}}))).matched,false)
})
test('Hello, Thank you, and Please cannot substitute for each other',()=>{
 for(const id of ['hello','thank_you','please'])for(const other of ['hello','thank_you','please']){
  if(id!==other)assert.equal(run(id,sequences[other]).matched,false,`${id} accepted ${other}`)
 }
})
test('head signs reject chest position; ME and YOU reject opposite pointing direction',()=>{
 for(const id of ['understand','question'])assert.equal(run(id,sequences[id].map(o=>({...o,dominant:{...o.dominant!,center:point(.3,.2)}}))).matched,false)
 assert.equal(run('me',sequences.me.map(o=>({...o,dominant:{...o.dominant!,axis:point(0,0,-1)}}))).matched,false)
 assert.equal(run('you',sequences.you.map(o=>({...o,dominant:{...o.dominant!,axis:point(0,0,1)}}))).matched,false)
})

function tracked():TrackedHand{
 const world=Array.from({length:21},()=>point())
 world[0]=point(0,.05)
 for(const [f,base] of [5,9,13,17].entries())for(let j=0;j<4;j++)world[base+j]=point(.03-f*.02,-j*.025)
 world[1]=point(.04,.035);world[2]=point(.055,.02);world[3]=point(.07,.005);world[4]=point(.085,-.01)
 return {world,points:world.map(p=>({x:.5+p.x*2,y:.5+p.y*2,z:p.z})),side:'Right',confidence:.99}
}
const pose=Array.from({length:33},()=>({...point(.5,.5),visibility:.99}))
pose[0]=({...point(.5,.25),visibility:.99});pose[11]=({...point(.65,.55),visibility:.99});pose[12]=({...point(.35,.55),visibility:.99})
test('landmark extraction rejects missing, clipped, nonfinite, low-confidence and duplicate hands',()=>{
 const h=tracked();assert.equal(classifyShape(h.world),'open')
 assert.equal(observe([h],pose,'Right',4/3,true).valid,true)
 assert.equal(observe([h],[],'Right',4/3,true).valid,false)
 assert.equal(observe([h],pose,'Left',4/3,true).valid,false)
 assert.equal(observe([h],pose,'Right',4/3,true,true).valid,false)
 assert.equal(observe([h,h],pose,'Right',4/3,true).valid,false)
 for(const bad of [{...h,confidence:.2},{...h,confidence:NaN},{...h,world:[]},{...h,points:h.points.map((p,i)=>i===8?{...p,x:1.2}:p)},{...h,world:h.world.map((p,i)=>i===5?{...p,z:NaN}:p)}])assert.equal(observe([bad],pose,'Right',4/3,true).valid,false)
})
test('mirroring the camera and handedness preserves palm-facing direction',()=>{
 const h=tracked(),mirror={...h,side:'Left' as const,points:h.points.map(p=>({...p,x:1-p.x})),world:h.world.map(p=>({...p,x:-p.x}))}
 assert.ok(observe([h],pose,'Right',4/3,true).dominant!.palm.z>.9)
 assert.ok(observe([mirror],pose,'Left',4/3,true).dominant!.palm.z>.9)
})

test('a tracker jump clears prior steps instead of counting as outward travel',()=>{
 const attempt=new PracticeAttempt('hello')
 for(let t=0;t<=300;t+=100)attempt.update(sequences.hello[0],t)
 const jumped=observation({center:point(1.1,-.55)})
 for(let t=400;t<=1200;t+=100)attempt.update(jumped,t)
 assert.equal(attempt.result().score,0)
})
test('a moving open hand cannot complete a stable foundation hold',()=>{
 const attempt=new PracticeAttempt('open')
 for(let t=0;t<5000;t+=100)attempt.update(observation({center:point((t%400)/1000,.2)}),t)
 assert.equal(attempt.result().matched,false)
})
test('the landmark pipeline can complete a real-shaped open-hand fixture',()=>{
 const attempt=new PracticeAttempt('open'),h=tracked()
 for(let t=0;t<=1300;t+=100)attempt.update(observe([h],[],'Right',4/3,false),t)
 assert.equal(attempt.result().matched,true)
})
test('two-hand coordination requires a steady support hand too',()=>{
 const attempt=new PracticeAttempt('two-open')
 for(let t=0;t<5000;t+=100)attempt.update(observation({center:point(.7,-.2)},hand({center:point(-.7-(t%400)/1000,-.2)})),t)
 assert.equal(attempt.result().matched,false)
})

test('Hello accepts a continuous oblique salute with relaxed fingers on either side',()=>{
 for(const side of [1,-1]){
  const attempt=new PracticeAttempt('hello')
  // No stationary pose: two frames at the brow, then a modest diagonal salute.
  const samples=[{x:.20,y:-.55},{x:.25,y:-.57},{x:.40,y:-.64},{x:.46,y:-.67}]
  samples.forEach(({x,y},i)=>attempt.update(observation({shape:null,fingerAngles:[150,158,148,139],center:point(side*x,y),tip:point(side*.06,-.82),palm:point(.99,0,.08)}),i*100))
  assert.equal(attempt.result().matched,true)
 }
})
test('Hello still rejects a static open hand, a downward stroke, a fist, and a chest-level wave',()=>{
 const brow=observation({center:point(.3,-.55),tip:point(.2,-.85)})
 for(const samples of [
  Array(12).fill(brow),
  [brow,brow,observation({center:point(.32,-.15)}),observation({center:point(.35,-.1)})],
  sequences.hello.map(o=>({...o,dominant:{...o.dominant!,shape:'fist' as const,fingerAngles:[80,80,80,80]}})),
  [observation({center:point(.3,.3),tip:point(.3,.1)}),observation({center:point(.6,.3),tip:point(.6,.1)})],
 ])assert.equal(run('hello',samples).matched,false)
})
test('occluded ears do not block tracking when the nose and shoulders are visible',()=>{
 const hiddenEars=pose.map((p,i)=>i===7||i===8?{...p,visibility:.1}:p)
 assert.equal(observe([tracked()],hiddenEars,'Right',4/3,true).valid,true)
 const hiddenShoulder=hiddenEars.map((p,i)=>i===11?{...p,visibility:.1}:p)
 assert.equal(observe([tracked()],hiddenShoulder,'Right',4/3,true).valid,false)
})

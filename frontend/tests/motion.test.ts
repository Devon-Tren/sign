import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSign, resolveTimeline, resolvedMotionFor } from '../src/motion/resolver'
import { curatedPhrase, curatedSign, sampleCurated } from '../src/motion/curated'
import { transitionDuration, transitionsFor } from '../src/motion/transitions'
import { blendOrientation } from '../src/motion/orientation'
import { coordinateHands } from '../src/motion/relationships'
import { primitiveAt } from '../src/motion/primitives'
import { phaseAt, defaultPhases } from '../src/motion/phases'
import { poseAt } from '../src/playback'
import { motionFor, allSignIds } from '../src/clips'
import { offlinePlan } from '../src/offlinePlan'
import type { PlaybackTimeline } from '../src/types'
const timeline = (ids: string[]): PlaybackTimeline => ({version:2,renderer:'sign-procedural-v2',duration_ms:ids.length*1000,clips:ids.map((id,i)=>({anchor:`s${i}`,sign_id:id.toUpperCase(),clip_id:id,start_ms:i*1000,end_ms:(i+1)*1000,realization:'test'})),nonmanuals:[]})
const norm = (v: readonly number[])=>Math.hypot(...v)
const delta = (a: readonly number[],b: readonly number[])=>norm(a.map((v,i)=>v-b[i]))

test('resolver selects curated signs, procedural signs, then fingerspelling',()=>{
 assert.equal(resolveSign('hello').source,'curated-sign')
 assert.equal(resolveSign('thank-you').source,'curated-sign')
 assert.equal(resolveSign('school').source,'procedural')
 assert.equal(resolveSign('xyzzy').clipId,'fs:XYZZY')
 assert.equal(resolveSign('fs:ZED').source,'fingerspelling')
 assert.notDeepEqual(resolvedMotionFor('fs:AB',.1).rightHand,resolvedMotionFor('fs:AB',.5).rightHand)
 assert.deepEqual(resolvedMotionFor('school',.4).rightArm?.target,motionFor('school',.4,{durationMs:resolveSign('school').durationMs}).rightArm?.target)
})
test('exact whole phrase overrides signs without swallowing extra words',()=>{
 assert.ok(curatedPhrase(['HELLO','THANK_YOU']))
 assert.equal(curatedPhrase(['HELLO','THANK_YOU','FS:JAMES']),undefined)
 const t=resolveTimeline(timeline(['hello','thank_you']))
 assert.equal(t.curated_phrase,'greeting_thanks_prototype')
 assert.ok(t.clips.every(c=>c.source==='curated-phrase'))
 assert.equal(t.duration_ms,2300)
 assert.equal(resolveTimeline(t),t)
 assert.equal(resolveTimeline(timeline(['hello','school'])).clips[0].source,'curated-sign')
})
test('authored endpoints and joint configurations are respected',()=>{
 const def=curatedSign('hello')!
 assert.deepEqual(sampleCurated(def,.18).rightArm?.target,[.12,.4,.3])
 assert.deepEqual(sampleCurated(def,1).rightArm?.target,def.keyframes.at(-1)!.right!.target)
 for(let t=0;t<=1;t+=.01){const p=sampleCurated(def,t);assert.ok(Number.isFinite(norm(p.rightArm!.target)))}
})
test('transition time reacts to distance, contact, activity and speed',()=>{
 const a=motionFor('hello',.5),b=structuredClone(a)
 b.rightArm!.target=[1,1,1]
 assert.ok(transitionDuration(a,b)>transitionDuration(a,a))
 const c=structuredClone(a);c.rightArm!.contact=true;a.rightArm!.contact=false
 assert.ok(transitionDuration(a,c)>transitionDuration(a,a))
 assert.ok(transitionDuration(a,b,1)>transitionDuration(a,b,.25))
 assert.ok(transitionDuration(a,b,2,300)<=126)
})
test('every mixed sign boundary and transition onset stays continuous',()=>{
 const t=resolveTimeline(timeline(['hello','school','help','fs:ABCDE','yes','no','please']))
 const edges=[...t.clips.slice(1).map(c=>c.start_ms),...transitionsFor(t).map(tr=>tr.start)]
 for(const ms of edges){
  const a=poseAt(t,ms-.00001),b=poseAt(t,ms+.00001)
  for(const side of ['rightArm','leftArm'] as const){assert.ok(delta(a[side]!.target,b[side]!.target)<1e-5,`position at ${ms}`);assert.ok(delta(a[side]!.palm,b[side]!.palm)<1e-5,`orientation at ${ms}`)}
 }
})
test('coherent quaternion interpolation stays orthogonal through opposing palms',()=>{
 for(let t=0;t<=1;t+=.05){const {palm,point}=blendOrientation([0,0,1],[0,1,0],[0,0,-1],[0,1,0],t);assert.ok(Math.abs(norm(palm)-1)<1e-8);assert.ok(Math.abs(palm.reduce((s,v,i)=>s+v*point[i],0))<1e-8)}
})
test('phrase timing remaps nonmanual spans and blends overlapping channels',()=>{
 const original=timeline(['hello','thank_you']);original.nonmanuals=[{profile_id:'wh',start_ms:0,end_ms:2000,controls:{brow:-.6,gaze:[.1,.1,0]}},{profile_id:'nod',start_ms:1000,end_ms:2000,controls:{headNod:.2}}]
 const t=resolveTimeline(original)
 assert.equal(t.nonmanuals[1].start_ms,t.clips[1].start_ms)
 const p=poseAt(t,1500);assert.equal(p.browFurrow,.6);assert.equal(p.browRaise,0);assert.equal(p.nonmanual?.headNod,.2)
 assert.deepEqual(p.nonmanual?.gaze,[.1,.1,0])
 assert.equal(poseAt(t,2301).browFurrow,0)
})
test('offline unknown content remains visible and playable',()=>{
 const p=offlinePlan('hello xyzzy')!
 assert.ok(p.gloss.includes('FS:XYZZY'))
 const t=resolveTimeline(p.timeline);assert.ok(t.duration_ms>0);assert.equal(t.clips[0].source,'curated-sign');assert.equal(t.clips[1].source,'fingerspelling')
})
test('phases, primitives, and hand relationships are usable',()=>{
 const phases=defaultPhases(1000)
 assert.equal(phaseAt(0,phases),'preparation');assert.equal(phaseAt(.9,phases),'transition')
 const p=motionFor('help',.5)
 const pair=coordinateHands(p.rightArm!,p.leftArm!,{type:'mirrored'},.5)
 assert.equal(pair.leftArm.target[0],-pair.rightArm.target[0])
 const contact=coordinateHands(p.rightArm!,p.leftArm!,{type:'contact',contactAt:.5},.7)
 assert.equal(contact.rightArm.contact,true)
 for(const type of ['linear','arc','semicircle','circle','ellipse','zigzag','bounce','tap','brush','twist','approach-contact','contact-release'] as const){
  const result=primitiveAt({type},.4);assert.ok(Number.isFinite(norm(result.offset)));assert.ok(Number.isFinite(result.twist))
 }
})
test('entire procedural vocabulary samples finite poses after refactor',()=>{
 for(const id of allSignIds()) for(const time of [.1,.45,.8]){
  const p=resolvedMotionFor(id,time)
  for(const side of ['rightArm','leftArm'] as const) assert.ok(Number.isFinite(norm(p[side]!.target)),id)
 }
})

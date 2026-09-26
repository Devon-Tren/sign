import { Suspense, useEffect, useRef, type RefObject, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { motionFor } from '../clips'

type AvatarProps={clipId:string; paused?:boolean; speed?:number; compact?:boolean; showGround?:boolean}
const SKIN='#ca9c79', SKIN_LIGHT='#dbb190', TEAL='#a8d9bb', DEEP='#163835', DARK='#152320'
const fingers=[-.165,-.052,.062,.17]
function Hand({side, curledRef}:{side:'left'|'right';curledRef:MutableRefObject<THREE.Group[]>}) {
  return <group>
    <mesh position={[0,-.105,0]} castShadow><boxGeometry args={[.44,.28,.16]}/><meshStandardMaterial color={SKIN} roughness={.83}/></mesh>
    {fingers.map((x,i)=><group key={i} position={[x,-.22,0]} ref={el=>{if(el)curledRef.current[(side==='left'?0:4)+i]=el}}>
      <mesh position={[0,-.18,0]} castShadow><capsuleGeometry args={[.044,.29,3,7]}/><meshStandardMaterial color={SKIN_LIGHT} roughness={.78}/></mesh>
      <mesh position={[0,-.35,.015]}><sphereGeometry args={[.044,8,8]}/><meshStandardMaterial color={SKIN_LIGHT}/></mesh>
    </group>)}
    <mesh position={[side==='left'?-.25:.25,-.01,.06]} rotation={[0,0,side==='left'?.66:-.66]}><capsuleGeometry args={[.063,.23,4,8]}/><meshStandardMaterial color={SKIN_LIGHT}/></mesh>
  </group>
}
function Arm({side,shoulderRef,elbowRef,handRef,fingersRef}:{
  side:'left'|'right';shoulderRef:RefObject<THREE.Group>;elbowRef:RefObject<THREE.Group>;
  handRef:RefObject<THREE.Group>;fingersRef:MutableRefObject<THREE.Group[]>;
}){
  const factor=side==='left'?-1:1
  return <group ref={shoulderRef} position={[factor*.66,2.26,0]}>
    <mesh position={[0,-.32,0]} castShadow><capsuleGeometry args={[.185,.42,5,12]}/><meshStandardMaterial color={TEAL} roughness={.89}/></mesh>
    <mesh position={[0,-.48,.02]}><sphereGeometry args={[.155,12,12]}/><meshStandardMaterial color={TEAL}/></mesh>
    <group ref={elbowRef} position={[0,-.58,.01]}>
      <mesh position={[0,-.24,0]} castShadow><capsuleGeometry args={[.15,.32,5,12]}/><meshStandardMaterial color={SKIN} roughness={.8}/></mesh>
      <mesh position={[0,-.41,0]}><sphereGeometry args={[.14,10,10]}/><meshStandardMaterial color={SKIN}/></mesh>
      <group ref={handRef} position={[0,-.49,0]} scale={.72}><Hand side={side} curledRef={fingersRef}/></group>
    </group>
  </group>
}
function Model({clipId,paused,speed}:{clipId:string;paused:boolean;speed:number}){
  const left=useRef<THREE.Group>(null), right=useRef<THREE.Group>(null)
  const leftElbow=useRef<THREE.Group>(null),rightElbow=useRef<THREE.Group>(null)
  const leftHand=useRef<THREE.Group>(null),rightHand=useRef<THREE.Group>(null)
  const neck=useRef<THREE.Group>(null),torso=useRef<THREE.Group>(null)
  const fingerRefs=useRef<THREE.Group[]>([])
  const elapsed=useRef(0)
  useEffect(()=>{elapsed.current=0},[clipId])
  useFrame((_,delta)=>{
    if (!paused) elapsed.current+=Math.min(delta,.07)*speed
    const pose=motionFor(clipId,elapsed.current)
    const lerp=(group:THREE.Group|null, key:'x'|'y'|'z',target:number)=>{if(group)group.rotation[key]=THREE.MathUtils.damp(group.rotation[key],target,9,delta)}
    lerp(left.current,'z',pose.left);lerp(right.current,'z',pose.right)
    lerp(leftElbow.current,'z',pose.leftElbow);lerp(rightElbow.current,'z',pose.rightElbow)
    lerp(leftHand.current,'z',pose.leftHand);lerp(rightHand.current,'z',pose.rightHand)
    lerp(neck.current,'z',pose.head);lerp(torso.current,'z',pose.torso)
    const bent=pose.shape==='fist'?[1,1,1,1]:pose.shape==='index'?[0,1,1,1]:[0,0,0,0]
    for (let i=0;i<fingerRefs.current.length;i++){
      const finger=fingerRefs.current[i]
      if (finger) finger.rotation.x=THREE.MathUtils.damp(finger.rotation.x,bent[i%4]*1.25,13,delta)
    }
  })
  return <group position={[0,-1.10,0]}>
    <group ref={torso}>
      <mesh position={[0,1.95,0]} castShadow><cylinderGeometry args={[.59,.47,1.0,16]}/><meshStandardMaterial color={TEAL} roughness={.84}/></mesh>
      <mesh position={[0,1.62,.44]}><boxGeometry args={[.14,.23,.025]}/><meshStandardMaterial color={DEEP} roughness={.7}/></mesh>
      <mesh position={[0,1.47,0]}><cylinderGeometry args={[.46,.44,.16,14]}/><meshStandardMaterial color={DARK}/></mesh>
      <mesh position={[-.20,.98,0]} castShadow><capsuleGeometry args={[.23,.65,6,10]}/><meshStandardMaterial color={DEEP}/></mesh>
      <mesh position={[.20,.98,0]} castShadow><capsuleGeometry args={[.23,.65,6,10]}/><meshStandardMaterial color={DEEP}/></mesh>
      <mesh position={[-.20,.43,.04]} castShadow><capsuleGeometry args={[.22,.65,6,10]}/><meshStandardMaterial color={DARK}/></mesh>
      <mesh position={[.20,.43,.04]} castShadow><capsuleGeometry args={[.22,.65,6,10]}/><meshStandardMaterial color={DARK}/></mesh>
      <mesh position={[-.20,.03,.18]} castShadow><boxGeometry args={[.43,.18,.65]}/><meshStandardMaterial color={'#243c35'}/></mesh>
      <mesh position={[.20,.03,.18]} castShadow><boxGeometry args={[.43,.18,.65]}/><meshStandardMaterial color={'#243c35'}/></mesh>
    </group>
    <group ref={neck} position={[0,2.56,0]}>
      <mesh position={[0,-.05,0]}><cylinderGeometry args={[.19,.18,.36,12]}/><meshStandardMaterial color={SKIN}/></mesh>
      <mesh position={[0,.35,.015]} castShadow><sphereGeometry args={[.47,28,28]}/><meshStandardMaterial color={SKIN_LIGHT} roughness={.93}/></mesh>
      <mesh position={[0,.63,-.02]} scale={[.48,.23,.44]}><sphereGeometry args={[1,20,14]}/><meshStandardMaterial color={'#302d29'} roughness={1}/></mesh>
      <mesh position={[-.2,.37,.438]} scale={[.055,.07,.032]}><sphereGeometry args={[1,9,9]}/><meshStandardMaterial color={'#293a31'}/></mesh>
      <mesh position={[.2,.37,.438]} scale={[.055,.07,.032]}><sphereGeometry args={[1,9,9]}/><meshStandardMaterial color={'#293a31'}/></mesh>
      <mesh position={[0,.23,.475]} scale={[.08,.07,.045]}><sphereGeometry args={[1,9,9]}/><meshStandardMaterial color={SKIN}/></mesh>
      <mesh position={[0,.11,.43]} scale={[.16,.024,.02]}><sphereGeometry args={[1,12,5]}/><meshStandardMaterial color={'#925f59'}/></mesh>
      <mesh position={[-.46,.35,-.02]} scale={[.09,.16,.09]}><sphereGeometry args={[1,12,12]}/><meshStandardMaterial color={SKIN}/></mesh>
      <mesh position={[.46,.35,-.02]} scale={[.09,.16,.09]}><sphereGeometry args={[1,12,12]}/><meshStandardMaterial color={SKIN}/></mesh>
    </group>
    <Arm side="left" shoulderRef={left} elbowRef={leftElbow} handRef={leftHand} fingersRef={fingerRefs}/>
    <Arm side="right" shoulderRef={right} elbowRef={rightElbow} handRef={rightHand} fingersRef={fingerRefs}/>
  </group>
}
export default function Avatar({clipId,paused=false,speed=1,compact=false,showGround=true}:AvatarProps){
  return <div className="avatar-canvas" role="img" aria-label="Articulated illustrative 3D person. Motions are unverified placeholders, not authentic ASL.">
    <Canvas shadows camera={{position:[0,1.3,compact?5.35:5.0],fov:40}} gl={{alpha:true,antialias:true}} dpr={[1,2]}>
      <Suspense fallback={null}>
        <ambientLight intensity={1.3}/><directionalLight position={[3,6,4]} intensity={2.3} castShadow shadow-mapSize={[1024,1024]}/>
        <directionalLight position={[-4,2,-4]} color={'#9accb3'} intensity={1.4}/>
        {showGround&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,-1.18,0]} receiveShadow><circleGeometry args={[2.5,60]}/><meshStandardMaterial color={'#dce9da'} roughness={1} transparent opacity={.45}/></mesh>}
        <Model clipId={clipId} paused={paused} speed={speed}/>
        <OrbitControls target={[0,.65,0]} enablePan={false} minDistance={3.1} maxDistance={7.5} minPolarAngle={.55} maxPolarAngle={2} enableDamping/>
      </Suspense>
    </Canvas>
  </div>
}

import {ArrowRight,AudioLines,BookOpen,GraduationCap,Radio} from 'lucide-react'
import type {Tab} from '../types'
import Avatar from './Avatar'

type HomeProps = {
  onNavigate: (tab: Tab) => void
}

export default function Home({onNavigate}:HomeProps){
  return <div className="home-entry"><main className="home-minimal">
    <section className="home-minimal-hero">
      <div className="home-minimal-copy">
        <div className="home-brand home-minimal-brand"><div className="brand-mark"><AudioLines size={25} strokeWidth={2.4}/></div><div className="brand-type"><strong>sign<span>.</span></strong><small>BRIDGING CONVERSATIONS</small></div></div>
        <p className="home-problem">Classrooms move quickly, and students who rely on captions, signs, or visual support need a calmer way to follow along, practice, and review what was said.</p>
      </div>
      <div className="home-character-card" aria-label="SIGN character preview">
        <Avatar clipId="idle" compact paused/>
      </div>
    </section>
    <nav className="home-action-row" aria-label="Open SIGN sections">
      <button className="home-action-button" onClick={()=>onNavigate('learn')}><GraduationCap size={19}/><span>Learn</span><ArrowRight size={15}/></button>
      <button className="home-action-button" onClick={()=>onNavigate('live')}><Radio size={19}/><span>Translate</span><ArrowRight size={15}/></button>
      <button className="home-action-button" onClick={()=>onNavigate('library')}><BookOpen size={19}/><span>Resources</span><ArrowRight size={15}/></button>
    </nav>
  </main></div>
}

import {ArrowRight,BookOpen,GraduationCap,Radio} from 'lucide-react'
import type {Tab} from '../types'
import Avatar from './Avatar'
import BrandLogo from './BrandLogo'

type HomeProps = {
  onNavigate: (tab: Tab) => void
}

export default function Home({onNavigate}:HomeProps){
  return <div className="home-entry"><main className="home-minimal">
    <header className="home-editorial-header">
      <div className="home-brand"><BrandLogo/></div>
      <div className="home-availability"><span className="small-dot"/> ACCESSIBILITY WORKSPACE <b>/ READY</b></div>
    </header>
    <section className="home-minimal-hero">
      <div className="home-minimal-copy">
        <div className="home-kicker">01 / LIVE ACCESSIBILITY PROTOTYPE</div>
        <h1>Every word,<br/><span>within reach.</span></h1>
        <p className="home-problem">Classrooms move quickly, and students who rely on captions, signs, or visual support need a calmer way to follow along, practice, and review what was said.</p>
      </div>
      <div className="home-character-card" aria-label="SIGN character preview">
        <Avatar clipId="idle" compact paused/>
        <div className="home-avatar-caption">FIG. 001 — SIGNING WORKSPACE / CANDIDATE MOTION</div>
      </div>
    </section>
    <nav className="home-action-row" aria-label="Open SIGN sections">
      <button className="home-action-button" onClick={()=>onNavigate('live')}><span className="home-action-index">01</span><Radio size={19}/><span><strong>Translate</strong><small>TEXT + LIVE AUDIO</small></span><ArrowRight size={15}/></button>
      <button className="home-action-button" onClick={()=>onNavigate('learn')}><span className="home-action-index">02</span><GraduationCap size={19}/><span><strong>Learn</strong><small>CAMERA PRACTICE</small></span><ArrowRight size={15}/></button>
      <button className="home-action-button" onClick={()=>onNavigate('library')}><span className="home-action-index">03</span><BookOpen size={19}/><span><strong>Resources</strong><small>SIGN LIBRARY</small></span><ArrowRight size={15}/></button>
    </nav>
  </main></div>
}

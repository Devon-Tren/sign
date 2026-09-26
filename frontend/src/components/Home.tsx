import {ArrowRight,AudioLines,BookOpen,GraduationCap,Info,Radio,ShieldAlert,Sparkles} from 'lucide-react'
import type {Tab} from '../types'
import Avatar from './Avatar'

type HomeProps = {
  onNavigate: (tab: Tab) => void
}

export default function Home({onNavigate}:HomeProps){
  return <div className="home-entry"><div className="page-content home-page">
    <header className="home-topbar"><div className="home-brand"><div className="brand-mark"><AudioLines size={25} strokeWidth={2.4}/></div><div className="brand-type"><strong>sign<span>.</span></strong><small>BRIDGING CONVERSATIONS</small></div></div><button className="secondary-button" onClick={()=>onNavigate('live')}>Enter workspace <ArrowRight size={14}/></button></header>
    <section className="home-hero">
      <div className="home-hero-copy"><div className="eyebrow"><span className="eyebrow-dot"/> SIGN HOME</div><h1>Accessible classroom support, gathered in one workspace<span className="heading-period">.</span></h1><p>SIGN pairs English captions with a controlled phrase catalog and an animated companion for early accessibility research.</p>
        <div className="heading-actions"><button className="primary-button home-primary" onClick={()=>onNavigate('learn')}>Start learning <ArrowRight size={16}/></button><button className="secondary-button" onClick={()=>onNavigate('live')}>Open classroom</button></div>
      </div>
      <div className="home-status-panel" aria-label="Prototype status summary">
        <div className="home-status-icon"><Sparkles size={22}/></div>
        <span>PROTOTYPE / 0.1</span>
        <strong>Caption-first, animation-assisted.</strong>
        <p>Unknown speech remains English captions. Only known phrase IDs can enter the animation queue.</p>
      </div>
    </section>
    <section className="home-preview-grid" aria-label="SIGN feature previews">
      <button className="home-preview-card home-preview-large" onClick={()=>onNavigate('learn')}>
        <div className="home-preview-visual"><Avatar clipId="hello" compact/><span className="home-preview-badge"><GraduationCap size={14}/> LEARNING STUDIO</span><span className="home-preview-caption">Illustrative avatar · not validated ASL</span></div>
        <div className="home-preview-copy"><strong>Practice from the same motion workspace.</strong><small>Start with guided handshape drills, compare against the avatar, and keep feedback framed as prototype support rather than ASL fluency scoring.</small><span>Start learning <ArrowRight size={15}/></span></div>
      </button>
      <button className="home-preview-card" onClick={()=>onNavigate('live')}>
        <div className="home-mini-transcript"><span><Radio size={15}/> LIVE CLASSROOM</span><p>“Today we are reviewing the assignment.”</p><div><em>assignment</em><em>today</em><em>review</em></div></div>
        <div className="home-preview-copy"><strong>Captions stay primary.</strong><small>Speech becomes English captions first, with known phrase IDs queued only when the catalog can support them.</small><span>Open classroom <ArrowRight size={15}/></span></div>
      </button>
      <button className="home-preview-card" onClick={()=>onNavigate('library')}>
        <div className="home-library-snapshot"><span><BookOpen size={15}/> PHRASE LIBRARY</span><div><strong>Hello</strong><small>DRAFT</small></div><div><strong>Question</strong><small>DRAFT</small></div><div><strong>Assignment</strong><small>DRAFT</small></div></div>
        <div className="home-preview-copy"><strong>Inspect the unverified catalog.</strong><small>Browse draft clips, provenance notes, and validation status before using anything as a demonstration.</small><span>View library <ArrowRight size={15}/></span></div>
      </button>
    </section>
    <section className="home-caveat">
      <ShieldAlert size={20}/>
      <div><strong>Prototype caveat</strong><p>Signing animations are illustrative and unverified. They are not validated ASL, not professional interpretation, and the tutor does not measure ASL fluency.</p></div>
      <button className="text-button" onClick={()=>onNavigate('settings')}>Read constraints <Info size={14}/></button>
    </section>
  </div></div>
}

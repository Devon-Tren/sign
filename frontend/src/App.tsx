import {useState} from 'react'
import {Activity,ArrowUpRight,AudioLines,BookOpen,GraduationCap,HelpCircle,PanelLeftClose,PanelLeftOpen,Radio,Settings2,Sparkles} from 'lucide-react'
import type {Tab} from './types'
import Live from './components/Live'
import Tutor from './components/Tutor'
import Library from './components/Library'
import Settings from './components/Settings'
const NAV:[Tab,string,typeof Radio,string][]=[['live','Live interpretation',Radio,'CLASSROOM'],['learn','Learning studio',GraduationCap,'LEARN'],['library','Phrase library',BookOpen,'RESOURCES'],['settings','Settings',Settings2,'WORKSPACE']]
export default function App(){
  const [tab,setTab]=useState<Tab>('live')
  const [collapsed,setCollapsed]=useState(false)
  return <div className={`app-shell ${collapsed?'sidebar-collapsed':''}`}>
    <aside className="sidebar"><div className="brand-row"><div className="brand-mark"><AudioLines size={25} strokeWidth={2.4}/></div>{!collapsed&&<div className="brand-type"><strong>sign<span>.</span></strong><small>BRIDGING CONVERSATIONS</small></div>}</div>
      <div className="nav-divider"/>
      <div className="sidebar-nav">{NAV.map(([id,label,Icon,group],i)=><div key={id}>{(i===0||NAV[i-1][3]!==group)&&!collapsed&&<div className="nav-category">{group}</div>}<button className={`nav-item ${tab===id?'active':''}`} onClick={()=>setTab(id)} title={collapsed?label:undefined}><Icon size={19}/>{!collapsed&&<span>{label}</span>}{tab===id&&<span className="nav-current"/>}</button></div>)}</div>
      <div className="sidebar-spacer"/>
      <div className="sidebar-build">{!collapsed&&<><div className="sidebar-build-icon"><Sparkles size={18}/></div><strong>Built to make space for everyone.</strong><p>Prototype v0.1 · Hackathon edition</p></>}<button className="collapse-toggle" title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(s=>!s)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div>
    </aside>
    <div className="main-shell"><header className="app-header"><div className="header-crumb">SIGN <span>/</span> <strong>{NAV.find(x=>x[0]===tab)?.[1]}</strong></div><div className="header-right"><div className="header-label"><span className="small-dot green"/> DEMO READY</div><div className="version-pill">BETA / 0.1</div><button className="header-help" title="About this prototype" onClick={()=>setTab('settings')}><HelpCircle size={19}/></button></div></header>
      <main key={tab}>{tab==='live'?<Live/>:tab==='learn'?<Tutor/>:tab==='library'?<Library/>:<Settings/>}</main>
      <footer className="app-footer"><div><Activity size={14}/> sign · an open-ended accessibility prototype</div><button onClick={()=>setTab('settings')}>About this demo <ArrowUpRight size={14}/></button></footer>
    </div>
  </div>
}

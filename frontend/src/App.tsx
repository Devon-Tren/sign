import {useState} from 'react'
import {Activity,ArrowUpRight,BookOpen,GraduationCap,HelpCircle,PanelLeftClose,PanelLeftOpen,Radio,ScanSearch,Settings2} from 'lucide-react'
import type {Tab} from './types'
import Home from './components/Home'
import Live from './components/Live'
import Tutor from './components/Tutor'
import Library from './components/Library'
import Settings from './components/Settings'
import ContactSheet from './components/ContactSheet'
import MotionInspector from './components/MotionInspector'
import BrandLogo from './components/BrandLogo'
import AccountMenu from './components/AccountMenu'
import {AccountProvider, useAccount} from './account'
import './account.css'
const NAV:[Exclude<Tab,'home'>,string,typeof Radio,string][]=[['live','Live interpretation',Radio,'CLASSROOM'],['learn','Learning studio',GraduationCap,'LEARN'],['library','Phrase library',BookOpen,'RESOURCES'],['inspect','Motion inspector',Activity,'RESOURCES'],['audit','Motion audit',ScanSearch,'RESOURCES'],['settings','Settings',Settings2,'WORKSPACE']]
export default function App(){
  return <AccountProvider><Workspace/></AccountProvider>
}
function Workspace(){
  const {user,loading:accountLoading}=useAccount()
  const [tab,setTab]=useState<Tab>('home')
  const [collapsed,setCollapsed]=useState(false)
  if(tab==='home')return <><div className="home-account"><AccountMenu/></div><Home onNavigate={setTab}/></>
  return <div className={`app-shell ${collapsed?'sidebar-collapsed':''}`}>
    <aside className="sidebar"><button className="brand-row brand-button" title="Back to home" onClick={()=>setTab('home')}><BrandLogo/></button>
      <div className="nav-divider"/>
      <div className="sidebar-nav">{NAV.map(([id,label,Icon,group],i)=><div key={id}>{(i===0||NAV[i-1][3]!==group)&&!collapsed&&<div className="nav-category">{group}</div>}<button className={`nav-item ${tab===id?'active':''}`} onClick={()=>setTab(id)} title={collapsed?label:undefined}><Icon size={19}/>{!collapsed&&<span>{label}</span>}{tab===id&&<span className="nav-current"/>}</button></div>)}</div>
      <div className="sidebar-spacer"/>
      <div className="sidebar-control-row"><button className="collapse-toggle" title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(s=>!s)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div>
    </aside>
    <div className="main-shell"><header className="app-header"><div className="header-crumb">SIGN <span>/</span> <strong>{NAV.find(x=>x[0]===tab)?.[1]}</strong></div><div className="header-right"><AccountMenu/><button className="header-help" title="About this prototype" onClick={()=>setTab('settings')}><HelpCircle size={19}/></button></div></header>
      <main key={tab}>{tab==='live'?<Live key={user?.id??'guest'}/>:tab==='learn'?(accountLoading?<p role="status">Loading account…</p>:<Tutor key={user?.id??'guest'}/>):tab==='library'?<Library/>:tab==='audit'?<ContactSheet/>:tab==='inspect'?<MotionInspector/>:<Settings/>}</main>
      <footer className="app-footer"><div><Activity size={14}/> sign · an open-ended accessibility prototype</div><button onClick={()=>setTab('settings')}>About this demo <ArrowUpRight size={14}/></button></footer>
    </div>
  </div>
}

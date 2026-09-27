import {useEffect,useMemo,useState} from 'react'
import {BookOpen,Check,ChevronRight,Info,Play,Search,ShieldAlert,SlidersHorizontal} from 'lucide-react'
import Avatar from './Avatar'
import {fetchPhrases} from '../api'
import {LOCAL_PHRASES} from '../data'
import type {Phrase} from '../types'
import {signParams} from '../clips'
import {authoredClipFor,authoredSequenceFor} from '../authored'
import {reviewFor,reviewReason,reviewLabels,type ReviewStatus} from '../libraryReview'

/**
 * Attribution for the ASL-LEX derived motion parameters. CC BY-NC 4.0
 * requires credit, so this is a licence obligation rather than decoration -
 * see data/LICENSE and NOTICE.
 */
function Provenance({phraseId}:{phraseId:string}){
  const p=signParams(phraseId)
  const authored=authoredClipFor(phraseId)??authoredSequenceFor(phraseId)
  if(authored) return <div className="preview-provenance"><Info size={15}/><span>
    Application-authored animation: {authored.variant}. Still unverified.
    {p?.asl_lex_entry?<> Underlying descriptor: <strong>ASL-LEX 2.0</strong> entry <code>{p.asl_lex_entry}</code>, CC BY-NC 4.0.</>:null}
    {authored.references.filter(url=>url.startsWith('https://')).map((url,i)=><span key={url}> <a href={url} target="_blank" rel="noreferrer">Movement reference {i+1}</a>.</span>)}
  </span></div>
  if(!p) return <div className="preview-provenance"><Info size={15}/><span>
    No published phonological description is mapped to this entry, so the motion is a generic placeholder.
  </span></div>
  if(!p.asl_lex_entry) return <div className="preview-provenance"><Info size={15}/><span>
    Application-authored procedural candidate. It has no captured-motion or published-lexicon provenance and remains unverified.
  </span></div>
  return <div className="preview-provenance"><Info size={15}/><span>
    Motion parameterised from <strong>ASL-LEX 2.0</strong> entry <code>{p.asl_lex_entry}</code>, CC BY-NC 4.0.
    {p.Handshape?<> Handshape <code>{p.Handshape}</code>; {p.MajorLocation} location; {p.Movement} movement.</>:null}
    {p.fidelity==="approximate"&&p.mapping_note?<em>Approximate mapping - {p.mapping_note}</em>:null}
  </span></div>
}

export default function Library(){
  const [phrases,setPhrases]=useState<Phrase[]>(LOCAL_PHRASES)
  const [query,setQuery]=useState('')
  const [category,setCategory]=useState('All')
  const [reviewFilter,setReviewFilter]=useState<ReviewStatus|'all'>('all')
  const [preview,setPreview]=useState<Phrase>(LOCAL_PHRASES[0])
  const categories=useMemo(()=>['All',...Array.from(new Set(phrases.map(p=>p.category)))],[phrases])
  const filtered=phrases.filter(p=>(reviewFilter==='all'||reviewFor(p.id)?.status===reviewFilter)&&(category==='All'||p.category===category)&&(p.english.toLowerCase().includes(query.toLowerCase())||p.aliases.toLowerCase().includes(query.toLowerCase())))
  useEffect(()=>{void fetchPhrases().then(setPhrases)},[])
  return <div className="page-content library-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> SIGN LIBRARY</div><h1>Every gesture starts here<span className="heading-period">.</span></h1><p>Browse the closed prototype catalog. Replace demonstrations with validated animation assets.</p></div><div className="lesson-total"><BookOpen size={20}/><span><strong>{phrases.length}</strong> draft clips</span></div></div>
    <div className="library-layout"><section className="library-list"><div className="library-filter"><div className="library-search"><Search size={18}/><input placeholder="Search phrases or keywords" value={query} onChange={e=>setQuery(e.target.value)}/></div><span className="filter-aux"><SlidersHorizontal size={16}/> FILTERS</span></div>
      <div className="filter-tags">{categories.map(cat=><button key={cat} className={`filter-tag ${category===cat?'active':''}`} onClick={()=>setCategory(cat)}>{cat}</button>)}</div>
      <div className="filter-tags" aria-label="Motion review filters">{(['all','skipped','updated','preserved'] as const).map(status=><button key={status} aria-pressed={reviewFilter===status} className={`filter-tag ${reviewFilter===status?'active':''}`} onClick={()=>setReviewFilter(status)}>{status==='all'?'All review statuses':reviewLabels[status]} ({phrases.filter(p=>status==='all'||reviewFor(p.id)?.status===status).length})</button>)}</div>
      <div className="catalog-header"><span>ENGLISH REFERENCE</span><span>STATUS</span></div>
      <div className="catalog-list">{filtered.length?filtered.map(phrase=><button className={`catalog-row ${preview.id===phrase.id?'focused':''}`} key={phrase.id} onClick={()=>setPreview(phrase)}><span className="catalog-avatar">{phrase.english.slice(0,1)}</span><span className="catalog-title"><strong>{phrase.english}</strong><small>{phrase.category} · {reviewFor(phrase.id)?reviewLabels[reviewFor(phrase.id)!.status]:'Not reviewed'}</small></span><span className="catalog-status">{phrase.validation_status==='validated'?<><Check size={12}/> Validated</>:'DRAFT'}</span><ChevronRight size={17} className="catalog-chevron"/></button>):<div className="empty-catalog">No matching phrases.</div>}</div>
    </section><section className="library-preview"><div className="library-preview-header"><span className="mini-heading"><Play size={16}/> ANIMATION PREVIEW</span><span className="draft-badge">UNVERIFIED</span></div><div className="library-avatar"><Avatar key={preview.id} clipId={preview.animation_file||preview.id} compact/></div><div className="library-preview-body"><div className="eyebrow subtle">{preview.category.toUpperCase()} / LEVEL {preview.level}</div><h2>{preview.english}</h2><p>{preview.notes}</p><div className="preview-provenance"><Info size={15}/><span><strong>{reviewFor(preview.id)?reviewLabels[reviewFor(preview.id)!.status]:'Not reviewed'}</strong>: {reviewReason(preview.id)}{reviewFor(preview.id)?.status==='skipped'&&reviewFor(preview.id)?.sources?.map(url=><span key={url}> <a href={url} target="_blank" rel="noreferrer">Reference</a></span>)}</span></div><div className="preview-meta"><span>Animation ID</span><code>{preview.animation_file||preview.id}</code></div><div className="preview-meta"><span>Matching phrases</span><span>{preview.aliases.split('|').join(', ')}</span></div><Provenance phraseId={preview.id}/><div className="preview-validation"><ShieldAlert size={16}/><span>This clip is a procedural stand-in, not a verified translation. A qualified ASL signer must approve the motion and non-manual markers.</span></div></div></section></div>
    <div className="tutor-disclaimer"><Info size={16}/> Phrase labels are English retrieval references; concatenating clips is not equivalent to grammatical ASL interpretation.</div>
  </div>
}

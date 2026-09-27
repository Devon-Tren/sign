import {useEffect, useState} from 'react'
import {Save, Trash2, BookOpen} from 'lucide-react'
import {accountRequest, useAccount} from '../account'
type Lecture = {session_id:string; title:string; text:string; created_at:string}
export default function SavedLectures({text, replay}:{text:string; replay:(text:string)=>void}) {
  const {user}=useAccount()
  const [title,setTitle]=useState('')
  const [records,setRecords]=useState<Lecture[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [sessionId]=useState(()=>crypto.randomUUID())
  const refresh=async()=>setRecords(await accountRequest<Lecture[]>('lectures'))
  useEffect(()=>{if(user)void refresh().catch(()=>setError('Could not load saved transcripts.'));else setRecords([])},[user])
  const save=async()=>{
    setBusy(true);setError('');setNotice('')
    try{await accountRequest('lectures',{session_id:sessionId,title:title.trim()||'Untitled lecture',text});await refresh();setNotice('Transcript saved.')}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not save transcript.')}
    finally{setBusy(false)}
  }
  const remove=async(id:string)=>{
    setBusy(true);setError('')
    try{await accountRequest(`lectures/${id}/delete`,{});await refresh()}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not delete transcript.')}
    finally{setBusy(false)}
  }
  return <section className="saved-lectures"><h2>Saved transcripts</h2>{!user?<button className="secondary-button" onClick={()=>window.dispatchEvent(new Event('sign-open-account'))}>Sign in to save lecture text</button>:<>
    <div className="lecture-save-row"><input aria-label="Lecture title" placeholder="Lecture title" maxLength={120} value={title} onChange={event=>setTitle(event.target.value)}/><button className="secondary-button" disabled={busy||!text.trim()||text.length>100000} onClick={()=>void save()}><Save size={16}/> Save transcript</button></div>
    <p className="account-hint">Saving uploads the current transcript text to your account. Only save material you have permission to retain.</p>
    {notice&&<p role="status">{notice}</p>}
    {!records.length&&<p>No saved transcripts yet.</p>}
    {records.map(record=><details key={record.session_id}><summary>{record.title} <small>{new Date(record.created_at).toLocaleDateString()}</small></summary><p className="lecture-text">{record.text}</p><div className="lecture-save-row"><button className="secondary-button" disabled={record.text.length>3000} title={record.text.length>3000?'Replay supports up to 3,000 characters':undefined} onClick={()=>replay(record.text)}><BookOpen size={16}/> Replay text</button><button className="round-control" title="Delete saved transcript" disabled={busy} onClick={()=>void remove(record.session_id)}><Trash2 size={16}/></button></div></details>)}
    {error&&<p role="alert" className="inline-error">{error}</p>}
  </>}</section>
}

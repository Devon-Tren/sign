import {TrendingUp, RefreshCw} from 'lucide-react'
import {useAccount, type Progress} from '../account'
import {LEARNING_ITEMS, learningItem} from '../learning'

export default function LearningHistory({progress, error, refresh, choose}: {progress: Progress|null; error: string; refresh: ()=>void; choose: (id:string)=>void}) {
  const {user} = useAccount()
  if(!user)return <section className="learning-history"><strong>Your learning journey</strong><p>Sign in to save attempts and continue across devices.</p><button className="secondary-button" onClick={()=>window.dispatchEvent(new Event('sign-open-account'))}>Sign in / Create account</button></section>
  const next = LEARNING_ITEMS.find(item=>item.practice.enabled&&!progress?.completed.includes(item.id))
  return <section className="learning-history" aria-label="Your learning history">
    <div className="history-heading"><h2>{user.name}'s progress</h2><button className="round-control" title="Refresh progress" onClick={refresh}><RefreshCw size={16}/></button></div>
    {error?<p className="inline-error" role="alert">{error}</p>:!progress?<p role="status">Loading your progress…</p>:<>
      <dl className="learning-metrics"><div><dt>Attempts</dt><dd>{progress.total_attempts}</dd></div><div><dt>Average handshape</dt><dd>{progress.average===null?'—':`${progress.average}%`}</dd></div><div><dt>Best handshape</dt><dd>{progress.best===null?'—':`${progress.best}%`}</dd></div><div><dt>Items completed</dt><dd>{progress.completed.length}</dd></div></dl>
      {next&&<button className="secondary-button" onClick={()=>choose(next.id)}>Continue with {next.name}</button>}
      {progress.items.length>0&&<div className="history-improvement">{progress.items.filter(item=>item.count>1).map(item=><span key={item._id}><TrendingUp size={15}/>{learningItem(item._id).name}: {item.latest-item.first>0?'+':''}{item.latest-item.first} points since first attempt</span>)}</div>}
      <h3>Recent attempts</h3>
      {!progress.recent.length?<p>Your first completed attempt will appear here.</p>:<div className="history-table"><table><thead><tr><th>Practice item</th><th>Handshape</th><th>Hold</th><th>Date</th></tr></thead><tbody>{progress.recent.slice(0,10).map(attempt=><tr key={attempt.attempt_id}><td><button className="account-switch" onClick={()=>choose(attempt.item_id)}>{learningItem(attempt.item_id).name}</button></td><td>{attempt.score}%</td><td>{attempt.hold_frames}/12 frames</td><td>{attempt.created_at?new Date(attempt.created_at).toLocaleString():''}</td></tr>)}</tbody></table></div>}
    </>}
  </section>
}

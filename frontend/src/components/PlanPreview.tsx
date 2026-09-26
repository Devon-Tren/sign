import Avatar from './Avatar'
import { useState } from 'react'
import { planASL } from '../api'
import type { PlanResult } from '../types'

export default function PlanPreview() {
  const [text, setText] = useState('Could you explain that again?')
  const [context, setContext] = useState('')
  const [result, setResult] = useState<PlanResult | null>(null)
  const [preview, setPreview] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    setBusy(true); setError(''); setResult(null)
    try { setResult(await planASL(text, context.trim() ? [context.trim()] : [])) }
    catch { setError('Planning unavailable. Start the backend and try again.') }
    finally { setBusy(false) }
  }
  return <section className="plan-preview" aria-labelledby="plan-title">
    <h2 id="plan-title">Classroom ASL plan</h2>
    <p>Inspect an experimental signing plan. Try “Hello” to rehearse an available motion. Candidate signs need ASL review before live playback.</p>
    <label htmlFor="plan-text">Classroom message</label>
    <input id="plan-text" value={text} maxLength={3000} disabled={busy} onChange={e => {setText(e.target.value);setResult(null)}} />
    <label htmlFor="plan-context">Recent context (optional)</label>
    <textarea id="plan-context" value={context} maxLength={3000} disabled={busy} onChange={e => {setContext(e.target.value);setResult(null)}} placeholder="For example: We are discussing recursion." />
    <button className="secondary-button" disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? 'Building plan…' : 'Preview ASL plan'}</button>
    <div aria-live="polite">
      {error && <p role="alert">{error}</p>}
      {result && <>
        <p><strong>{result.review_status === 'reviewed' ? 'Reviewed' : 'Candidate'} · {result.mode === 'catalog-example' ? (result.review_status === 'reviewed' ? 'Approved catalog example' : 'Unreviewed catalog example') : result.mode === 'experimental-model' ? 'Experimental model output' : 'Unavailable'}</strong></p>
        {result.plan && <>
          <p>Intent: {result.plan.meaning.intent} · Action: {result.plan.meaning.predicate} · {result.plan.meaning.negated ? 'Negated' : 'Not negated'}</p>
          <div className="matched-chips">{result.plan.manual_sequence.map((s,i) => <span className="phrase-tag" key={i}>{s.sign_id}</span>)}</div>
        </>}
        {[...result.unresolved, ...(result.validation?.issues || []), ...(result.validation?.motion_issues || [])].map((issue,i) => <p key={i}>{issue}</p>)}
        {result.rehearsal && <>
          <p>Unverified rehearsal for reviewer inspection. This does not approve the sequence.</p>
          <button className="secondary-button" onClick={() => setPreview(p => p + 1)}>Replay rehearsal</button>
          <div style={{height: 350}}><Avatar key={preview} clipId="rehearsal" timeline={result.rehearsal} compact /></div>
        </>}
        <details><summary>Inspect complete plan</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
      </>}
    </div>
  </section>
}

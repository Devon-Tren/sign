import type { Interpretation, Phrase } from './types'
import { LOCAL_PHRASES, localInterpret } from './data'
const base = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

export async function fetchHealth(): Promise<{status: string; live_configured: boolean; transcription_model:string; catalog_backend:string}|null> {
  try { const r = await fetch(`${base}/api/health`, { signal:AbortSignal.timeout(2000) }); return r.ok ? await r.json() : null }
  catch { return null }
}
export async function fetchPhrases(): Promise<Phrase[]> {
  try { const r = await fetch(`${base}/api/phrases`,{signal:AbortSignal.timeout(3000)}); return r.ok ? await r.json() : LOCAL_PHRASES }
  catch { return LOCAL_PHRASES }
}
export async function interpret(text:string, phrases:Phrase[], context:string[]=[]): Promise<Interpretation> {
  try {
    const r = await fetch(`${base}/api/interpret`, {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,context}), signal:AbortSignal.timeout(4000)})
    if (!r.ok) throw new Error(`API ${r.status}`)
    return await r.json() as Interpretation
  } catch { return localInterpret(text,phrases,context) }
}
export async function generateFeedback(drill_name:string, observed:string, expected:string, score:number):Promise<string> {
  try {
    const r = await fetch(`${base}/api/feedback`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({drill_name,observed,expected,score}),signal:AbortSignal.timeout(12000)})
    if (!r.ok) throw new Error()
    const data=await r.json();return data.feedback || observed
  } catch { return `Observed: ${observed}. Target: ${expected}. Adjust one finger at a time and retry.` }
}
export function liveWsUrl():string {
  if (base) return `${base.replace(/^http/,'ws')}/ws/live`
  const proto=location.protocol==='https:'?'wss':'ws'
  return `${proto}://${location.host}/ws/live`
}

export async function planASL(text: string, context: string[], fast = false): Promise<import('./types').PlanResult> {
  const request = (includeFast: boolean) => fetch(`${base}/api/plan`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(includeFast ? {text,context,fast} : {text,context}),
    signal: AbortSignal.timeout(fast ? 6000 : 30000),
  })
  let response = await request(true)
  // A dev server may still be running the pre-fast schema. Keep typing useful
  // immediately; after backend restart the deterministic fast flag takes over.
  if (fast && response.status === 422) response = await request(false)
  if (!response.ok) throw new Error(`Planner API ${response.status}`)
  return response.json()
}

export async function transcribeAudio(file: File): Promise<{text: string; filename?: string; model?: string}> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`${base}/api/transcribe-audio`, {
    method: 'POST', body, signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) {
    let message = `Audio transcription API ${response.status}`
    try {
      const error = await response.json()
      if (error?.detail) message = error.detail
    } catch {}
    throw new Error(message)
  }
  return response.json()
}

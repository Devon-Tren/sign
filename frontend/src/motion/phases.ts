import type { Phase, Phases } from './types'

export function defaultPhases(durationMs: number): Phases {
  const prep = Math.min(170 / durationMs, .25)
  const release = Math.min(200 / durationMs, .25)
  return [prep, prep + Math.min((1 - prep - release) * .62, 520 / durationMs), 1 - release]
}
export function phaseAt(t: number, phases: Phases): Phase {
  return t < phases[0] ? 'preparation' : t < phases[1] ? 'stroke' : t < phases[2] ? 'hold' : 'transition'
}
export function proceduralPhase(ms: number, duration: number, morphemes = 1, override?: Phases): Phase {
  const phases = override ?? defaultPhases(duration)
  if (ms < phases[0]*duration) return 'preparation'
  if (ms >= phases[2]*duration) return 'transition'
  const segment = (phases[2]-phases[0])*duration/morphemes
  const local = (ms-phases[0]*duration)%segment
  const stroke = override ? (phases[1]-phases[0])*duration/morphemes : Math.min(segment*.62,520)
  return local < stroke ? 'stroke' : 'hold'
}
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
export const smoothstep = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x) }

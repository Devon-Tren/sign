/** ASL-Phono estimates fill missing channels; they never replace ASL-LEX. */
import data from '../../data/asl_phono_priors.json'
import type { Vec3 } from './clips'

export type DirectionEvidence = {
  direction: string
  vector: Vec3
  votes: number
  observations: number
  consensus: number
  mean_confidence: number
  supporting_samples: number
  accepted: boolean
}
export type PhonoPrior = {
  label: string
  sample_count: number
  sample_ids: string[]
  orientation_dh: DirectionEvidence | null
  movement_dh: DirectionEvidence | null
}
const PRIORS = (data as unknown as { signs: Record<string, PhonoPrior> }).signs

export function phonoPriorFor(id: string): PhonoPrior | null {
  return PRIORS[id] ?? null
}

/** Recheck the actual votes at runtime: rounded display percentages cannot
 * accidentally admit a tie, and corrupt/zero directions fail closed. */
export function acceptedDirection(evidence?: DirectionEvidence | null): Vec3 | null {
  if (!evidence?.accepted || evidence.observations <= 0
      || !Number.isInteger(evidence.votes) || !Number.isInteger(evidence.observations)
      || !Number.isFinite(evidence.consensus)
      || evidence.votes > evidence.observations || evidence.votes * 2 <= evidence.observations
      || evidence.consensus <= 0.5 || evidence.consensus > 1) return null
  const v = evidence.vector
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return null
  const length = Math.hypot(...v)
  return length > 0.999 && length < 1.001 ? v : null
}

/** Preserve the estimated palm normal, projecting the derived finger axis into
 * its plane. Parallel directions otherwise collapse the wrist basis. */
export function pointForPalm(palm: Vec3, preferred: Vec3): Vec3 {
  const project = (v: Vec3): Vec3 => {
    const dot = v[0] * palm[0] + v[1] * palm[1] + v[2] * palm[2]
    return [v[0] - dot * palm[0], v[1] - dot * palm[1], v[2] - dot * palm[2]]
  }
  const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  // Stable fallback, itself continuous: "up" in the palm plane, fading to
  // "forward" as the palm turns vertical (a hard switch at 0.9 used to jump).
  const vertical = smooth(0.8, 0.95, Math.abs(palm[1]))
  const up = project([0, 1, 0]), forward = project([0, 0, 1])
  const fallback = unit([
    up[0] * (1 - vertical) + forward[0] * vertical,
    up[1] * (1 - vertical) + forward[1] * vertical,
    up[2] * (1 - vertical) + forward[2] * vertical,
  ])
  // A preferred direction nearly parallel to the palm leaves a tiny residual
  // whose direction is noise; using it flipped fingers 90-180 degrees between
  // frames (ASSIGNMENT). Fade to the fallback as the residual shrinks.
  const residual = project(preferred)
  const r = Math.hypot(...residual)
  const trust = smooth(0.08, 0.35, r)
  const own = r > 1e-9 ? [residual[0] / r, residual[1] / r, residual[2] / r] : fallback
  const mixed: Vec3 = [
    own[0] * trust + fallback[0] * (1 - trust),
    own[1] * trust + fallback[1] * (1 - trust),
    own[2] * trust + fallback[2] * (1 - trust),
  ]
  return Math.hypot(...mixed) > 1e-6 ? unit(project(mixed)) : fallback
}

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
  let point = project(preferred)
  if (Math.hypot(...point) < 0.001) {
    point = project(Math.abs(palm[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1])
  }
  const length = Math.hypot(...point)
  return [point[0] / length, point[1] / length, point[2] / length]
}

import data from '../../data/asl_authored_motions.json'
import type { ArmPose } from './clips'

export type AuthoredFrame = { at: number; phase: string; right: ArmPose; left?: ArmPose }
export type AuthoredClip = {
  variant: string
  references: string[]
  duration_ms: { isolated: number; continuous: number }
  right_handshape: string
  left_handshape?: string
  keyframes: AuthoredFrame[]
}
export type AuthoredSequence = { clips: string[]; variant: string; references: string[] }
const authored = data as unknown as {
  clips: Record<string, AuthoredClip>
  sequences: Record<string, AuthoredSequence>
}
export const authoredClipFor = (id: string): AuthoredClip | null => authored.clips[id] ?? null
export const authoredSequenceFor = (id: string): AuthoredSequence | null => authored.sequences[id] ?? null

export type Tab = 'live' | 'learn' | 'library' | 'settings'
export type Phrase = {
  id: string
  english: string
  aliases: string
  category: string
  level: number
  validation_status: 'illustrative' | 'validated'
  notes: string
  animation_file: string | null
}
export type SelectedPhrase = {
  playback?: PlaybackTimeline
  phrase_id: string
  label: string
  matched_text: string
  validation_status: 'illustrative' | 'validated'
  animation_file: string | null
}
export type Interpretation = {
  spoken: string
  selected: SelectedPhrase[]
  mode: string
  coverage: 'illustrative-only' | 'unsupported'
  note: string
}
export type Segment = {
  id: number
  text: string
  timestamp: Date
  selected: SelectedPhrase[]
  planResult?: PlanResult
  planError?: string
  coverage?: Interpretation['coverage']
  source: 'demo' | 'microphone' | 'text'
}
export type Drill = {
  id: string
  title: string
  level: 1 | 2 | 3
  intro: string
  target: 'open' | 'index' | 'fist' | 'two-open'
  clipId: string
  instructions: string[]
}

export type PlanResult = {
  source_text: string
  mode: 'catalog-example' | 'experimental-model' | 'unavailable'
  review_status: 'candidate' | 'reviewed'
  playback: PlaybackTimeline | null
  rehearsal: PlaybackTimeline | null
  review_fingerprint?: string
  unresolved: string[]
  plan: null | {
    meaning: { intent: string; predicate: string; negated: boolean }
    manual_sequence: { id: string; sign_id: string }[]
  }
  validation: null | { issues: string[]; motion_issues: string[]; executable: boolean }
}

export type PlaybackTimeline = {
  version: 1
  renderer: 'asl-lex-procedural-v1'
  duration_ms: number
  clips: {anchor: string; sign_id: string; clip_id: string; start_ms: number; end_ms: number}[]
  nonmanuals: {profile_id: string; start_ms: number; end_ms: number; controls: {
    brow: number; mouth: number; head: readonly [number, number, number]; torso: number
  }}[]
}

export type Tab = 'home' | 'live' | 'learn' | 'library' | 'audit' | 'inspect' | 'settings'
export type Phrase = {
  id: string
  english: string
  aliases: string
  category: string
  level: number
  validation_status: 'illustrative' | 'validated'
  notes: string
  animation_file: string | null
  meaning: string
  context_aliases: string
  positive_contexts: string
  negative_contexts: string
  match_threshold: number
}
export type SelectedPhrase = {
  playback?: PlaybackTimeline
  gloss?: string[]
  phrase_id: string
  label: string
  matched_text: string
  validation_status: 'illustrative' | 'validated'
  animation_file: string | null
  meaning?: string
  match_confidence: number
  match_threshold: number
  match_kind: 'exact' | 'contextual' | 'fallback'
  match_reason: string
  rendering_source?: 'catalog' | 'catalog-plan' | 'fingerspelling-fallback'
}
export type MatchGate = {
  status: 'matched' | 'captions-only'
  strategy: 'context-aware-catalog-v1'
  confidence: number
  context_used: boolean
  reason: string
}
export type Interpretation = {
  spoken: string
  selected: SelectedPhrase[]
  mode: string
  coverage: 'illustrative-only' | 'unsupported'
  gate: MatchGate
  note: string
}
export type Segment = {
  id: number
  text: string
  timestamp: Date
  selected: SelectedPhrase[]
  catalogMatches?: SelectedPhrase[]
  planResult?: PlanResult
  planError?: string
  coverage?: Interpretation['coverage']
  gate?: MatchGate
  source: 'demo' | 'microphone' | 'text'
}
export type HandshapeTarget = 'open' | 'index' | 'fist' | 'two-open'
export type PracticeMode = 'handshape' | 'full-sign' | 'demo-only'
export type LearningItem = {
  id: string
  lessonId: string
  name: string
  description: string
  animationId: string
  instructions: string[]
  components: {
    handshape?: string
    position?: string
    movement?: string
    orientation?: string
    focus?: string
  }
  practice: {
    enabled: boolean
    mode: PracticeMode
    targetHandState?: HandshapeTarget
    scopeLabel: string
  }
  validationStatus: 'illustrative' | 'unverified' | 'reviewed'
}
export type Lesson = {
  id: string
  title: string
  subtitle: string
  items: string[]
}

export type PlanResult = {
  source_text: string
  mode: 'catalog-example' | 'catalog-composed' | 'experimental-model' | 'experimental-openai' | 'experimental-gemini' | 'fingerspell-fallback' | 'unavailable'
  review_status: 'candidate' | 'reviewed'
  playback: PlaybackTimeline | null
  rehearsal: PlaybackTimeline | null
  review_fingerprint?: string
  unresolved: string[]
  plan: null | {
    meaning: { intent: string; predicate: string; negated: boolean }
    manual_sequence: { id: string; sign_id: string }[]
  }
  validation: null | { issues: string[]; motion_issues: string[]; executable: boolean; playback_policy: string; linguistic_review: string }
}

export type PlaybackTimeline = {
  version: 2
  renderer: 'sign-procedural-v2'
  duration_ms: number
  clips: {anchor: string; sign_id: string; clip_id: string; start_ms: number; end_ms: number; realization: string}[]
  nonmanuals: {profile_id: string; start_ms: number; end_ms: number; controls: {
    brow: number; mouth: number; head: readonly [number, number, number]; torso: number
  }}[]
}

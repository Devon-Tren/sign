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

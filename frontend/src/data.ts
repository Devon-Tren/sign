import type { Drill, Interpretation, Phrase, SelectedPhrase } from './types'

export const LOCAL_PHRASES: Phrase[] = [
  ['hello','Hello','hello','Greeting',1],
  ['thank_you','Thank you','thank you|thanks','Courtesy',1],
  ['yes','Yes','yes|correct|that is right','Responses',1],
  ['no','No','no|not really','Responses',1],
  ['help','Help','help|can you help','Classroom',1],
  ['good_morning','Good morning','good morning','Greeting',1],
  ['question','Question','question|any questions','Classroom',2],
  ['learn','Learn','learn|learning|we will learn','Classroom',2],
  ['understand','Understand','understand|i understand|do you understand','Classroom',2],
  ['today','Today','today','Classroom',2],
  ['artificial_intelligence','Artificial intelligence','artificial intelligence|ai','Technology',3],
  ['computer','Computer','computer|computers','Technology',3],
].map(([id, english, aliases, category, level]) => ({
  id: String(id), english: String(english), aliases: String(aliases), category: String(category),
  level: Number(level), validation_status: 'illustrative' as const,
  notes: 'Demo animation placeholder; not validated ASL.', animation_file: null,
}))

export const DEMO_SCRIPT = [
  'Good morning, everyone. Thank you for being here today.',
  'Today we are going to learn about artificial intelligence.',
  'Artificial intelligence helps computers recognize patterns.',
  'If you have a question, please ask for help.',
  'Do you understand? Yes? Great. Any questions?',
  'Thank you, and I hope you have a good morning.',
]

function norm(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
export function localInterpret(text: string, phrases: Phrase[] = LOCAL_PHRASES): Interpretation {
  const padded = ` ${norm(text)} `
  const matches: { start: number, end: number, phrase: Phrase, alias: string }[] = []
  for (const phrase of phrases) for (const raw of phrase.aliases.split('|')) {
    const alias = norm(raw)
    if (!alias) continue
    const token = ` ${alias} `
    let start = padded.indexOf(token)
    while (start !== -1) {
      matches.push({start, end: start + token.length, phrase, alias})
      start = padded.indexOf(token, start + 1)
    }
  }
  matches.sort((a, b) => (b.end-b.start)-(a.end-a.start))
  const used: {start:number,end:number}[] = []
  const selected: {start: number, phrase: SelectedPhrase}[] = []
  for (const match of matches) {
    if (used.some(x => match.start < x.end && match.end > x.start)) continue
    used.push(match)
    selected.push({start: match.start, phrase: {
      phrase_id: match.phrase.id, label: match.phrase.english, matched_text: match.alias,
      animation_file: match.phrase.animation_file, validation_status: match.phrase.validation_status,
    }})
  }
  selected.sort((a,b)=>a.start-b.start)
  return {
    spoken: text, selected: selected.slice(0,8).map(x=>x.phrase),
    mode:'local-demo', coverage:selected.length?'illustrative-only':'unsupported',
    note: selected.length?'Illustrative animation only; English captions remain the complete message.':'No matching animation; captions remain available.',
  }
}

export const DRILLS: Drill[] = [
  {id:'open', title:'Open hand', level:1, target:'open', clipId:'hello',
   intro:'Start with four extended fingers. Keep your hand comfortably in view.',
   instructions:['Face your palm toward your camera','Extend your index, middle, ring and little fingers','Hold the position until the stability ring fills']},
  {id:'fist', title:'Closed hand', level:1, target:'fist', clipId:'yes',
   intro:'Make a relaxed fist without straining your fingers.',
   instructions:['Place your wrist within the camera frame','Curl all four fingers gently','Hold while the tracker checks your handshape']},
  {id:'index', title:'Index extension', level:2, target:'index', clipId:'question',
   intro:'Practice independent finger control using one extended index finger.',
   instructions:['Extend your index finger','Keep your middle, ring and little fingers curled','Hold for a stable reading']},
  {id:'two-open', title:'Two-hand coordination', level:3, target:'two-open', clipId:'learn',
   intro:'Show an open palm with each hand, simultaneously.',
   instructions:['Fit both hands in the camera frame','Extend all four fingers on both hands','Hold both positions together']},
]

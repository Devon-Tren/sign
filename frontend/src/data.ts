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
  meaning: String(id)==='artificial_intelligence'
    ? 'Artificial intelligence, machine learning, or computer intelligence.'
    : `Stored meaning for ${String(english).toLowerCase()}.`,
  context_aliases: String(id)==='artificial_intelligence' ? 'intelligence' : '',
  positive_contexts: String(id)==='artificial_intelligence'
    ? 'artificial|machine learning|computer|computers|algorithm|model|software|technology|data|automation' : '',
  negative_contexts: String(id)==='artificial_intelligence'
    ? 'military|classified|spy|espionage|intelligence agency|intelligence report|intelligence officer' : '',
  match_threshold: String(id)==='artificial_intelligence' ? .88 : .90,
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
function terms(value: string) { return value.split('|').map(norm).filter(Boolean) }
function contains(source: string, term: string) { return source.includes(` ${term} `) }

export function localInterpret(text: string, phrases: Phrase[] = LOCAL_PHRASES, context: string[] = []): Interpretation {
  const padded = ` ${norm(text)} `
  const combined = ` ${norm([...context.slice(-5),text].join(' '))} `
  const matches: {start:number,end:number,phrase:Phrase,alias:string,confidence:number,reason:string,kind:'exact'|'contextual'}[] = []
  const rejected: string[] = []
  for (const phrase of phrases) {
    const aliases:{alias:string,needsContext:boolean}[] = [
      ...terms(phrase.aliases).map(alias=>({alias,needsContext:false})),
      ...terms(phrase.context_aliases).map(alias=>({alias,needsContext:true})),
    ]
    for (const {alias,needsContext} of aliases) {
      const token = ` ${alias} `
      let start = padded.indexOf(token)
      while (start !== -1) {
        const positive=terms(phrase.positive_contexts).find(term=>contains(combined,term))
        const negative=terms(phrase.negative_contexts).find(term=>contains(combined,term))
        if (needsContext&&negative) rejected.push(`“${alias}” was not mapped to ${phrase.english}: conflicting context (${negative}).`)
        else if (needsContext&&!positive) rejected.push(`“${alias}” needs more context before it can be mapped to ${phrase.english}.`)
        else {
          const confidence=alias.includes(' ')?.99:needsContext?.92:.96
          if(confidence>=phrase.match_threshold) matches.push({
            start,end:start+token.length,phrase,alias,confidence,
            reason:needsContext?`Context supports the stored meaning (${positive}).`:'Exact stored phrase match.',
            kind:needsContext?'contextual':'exact',
          })
        }
        start = padded.indexOf(token, start + 1)
      }
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
      meaning:match.phrase.meaning,match_confidence:match.confidence,
      match_threshold:match.phrase.match_threshold,match_kind:match.kind,match_reason:match.reason,
    }})
  }
  selected.sort((a,b)=>a.start-b.start)
  const accepted=selected.slice(0,8).map(x=>x.phrase)
  const confidence=accepted.length?Math.min(...accepted.map(x=>x.match_confidence)):0
  return {
    spoken: text, selected:accepted,
    mode:'local-demo', coverage:selected.length?'illustrative-only':'unsupported',
    gate:{status:accepted.length?'matched':'captions-only',strategy:'context-aware-catalog-v1',
      confidence,context_used:context.length>0,
      reason:accepted.length?`${accepted.length} stored meaning match(es) passed the gate.`:
        rejected[0]||'No stored meaning matched the transcript.'},
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

/** Reproduce the ranked orientation review and its requested-pose snapshot. */
import fs from 'node:fs/promises'
import { allSignIds, augmentFor, clipLengthMs, motionFor, signParams } from '../src/clips'

const uncertain: Record<string, string> = {
  water: 'Check W/index-side contact at chin before replacing the generic inward head normal.',
  yes: 'Static outward start is plausible; the missing wrist nod requires phase-dependent orientation, not one replacement normal.',
  oh_i_see: 'Y-hand lexical variant must be identified before changing the neutral outward normal.',
  me: 'Inward palm is plausible, but the original palm/point pair was nearly parallel. A perpendicular frame alone does not restore index-to-chest contact.',
  sleep: 'Inward/medial pooled prior is plausible; compare the closing-hand phases before replacing it.',
  car: 'Steering-wheel variant has an inward/upward/medial prior. Need the actual wrist phase before choosing a different tilt.',
  evening: 'Support-hand relation alone cannot specify the dominant arc and its changing normal.',
  tired: 'The rolling-down chest gesture needs separate orientation phases.',
  ok: 'Lexicalised fingerspelling path; an augment orientation would not fix its letter transitions.',
  this: 'Indexing direction depends on the referent; neutral palm-out is suspicious but a fixed replacement is not justified.',
  let_me_see: 'Check lexical variant and eye-level pointing direction; do not equate it automatically with SEE.',
  paper: 'Palm contact and sliding phase need a two-hand reference comparison.',
  we_will_see: 'Variant/inflection needs phase-specific reference; generic head orientation is not sufficient evidence.',
  home: 'Compact-O contact normal must follow the mouth-to-cheek phases.',
  friend: 'Hooked-index contact alternates; one normal would miss the interchange.',
  he: 'Deictic locus is missing, so no universal citation pointing direction was assigned.',
  do_do: 'Current loan-sign path fingerspells; the palm-up lexicalised citation form needs its own phases. An unused orientation augment would be misleading.',
  coffee: 'The contact relation suppresses the pooled prior; inspect both fists and the grinding phase before choosing a replacement.',
  read: 'Dominant scanning fingers and non-dominant page need independent orientations.',
  time: 'Oblique down/medial prior is plausible for wrist contact; check the selected-finger contact geometry.',
  variable: 'Meaning/lexical variant and the ulnar-rotation phase need confirmation.',
  ready: 'Published sweep, preparation and shaking variants differ; do not impose one orientation on all of them.',
  tomorrow: 'Thumb-at-cheek roll needs phase-specific normals; generic outward head-away rule is suspicious.',
  door: 'Hinged dominant hand and stationary hand need separate frames; a static normal cannot establish the hinge.',
  nothing: 'O-hand variant and its outward/downward/medial prior need a matching citation video.',
  category: 'Identify the C-hand grouping variant and its start/end orientation before replacing the neutral fallback.',
}
const retained: Record<string, string> = {
  i_love_you: 'No obvious palm contradiction: outward ILY presentation. This is not whole-sign validation.',
  eat: 'Inward palm is compatible with the compact-O mouth gesture; contact and handshape are separate issues. https://www.lifeprint.com/asl101/pages-signs/e/eat.htm',
  work: 'Downward dominant palm agrees with the citation; check both-fist contact separately. https://www.lifeprint.com/asl101/pages-signs/w/work.htm',
  bathroom: 'No confident palm contradiction established for the T-hand shake. https://www.lifeprint.com/asl101/pages-signs/b/bathroom.htm',
  love: 'Inward chest-facing palms are plausible; crossed-arm placement needs separate review. https://www.lifeprint.com/asl101/pages-signs/l/love.htm',
  hello: 'Existing authored salute retained; coordinator independently reviewed greetings.',
  good: 'Existing authored inward-to-up palm retained; coordinator independently reviewed greetings.',
  no: 'Outward citation palm is plausible; NO is directional and has variants. https://www.lifeprint.com/asl101/pages-signs/n/no.htm',
  today: 'Existing upward palms agree with the NOW+NOW/Y-hand citation variant. https://www.lifeprint.com/asl101/pages-signs/t/today.htm',
  school: 'Downward dominant contact palm is plausible; the clap timing is a separate issue. https://www.lifeprint.com/asl101/pages-signs/s/school.htm',
  friday: 'Outward palm is explicitly an accepted variant; do not replace it just to match an inward example. https://www.lifeprint.com/asl101/pages-signs/f/friday.htm',
  my: 'Inward flat palm agrees with chest contact. https://www.lifeprint.com/asl101/pages-signs/m/my.htm',
}
const changed = new Set(['you', 'book', 'more', 'what', 'must', 'thank_you', 'drink', 'see', 'better'])
const family = new Set(['father', 'mother', 'parents'])
const ids = allSignIds().filter(id => !signParams(id)?.app_authored)
  .sort((a, b) => (signParams(b)?.SignFrequency ?? 0) - (signParams(a)?.SignFrequency ?? 0)).slice(0, 50)
const rows = ids.map((id, i) => ({
  rank: i + 1, id, frequency: signParams(id)?.SignFrequency,
  status: changed.has(id) ? 'Override corrected' : family.has(id) ? 'Source rule corrected'
    : uncertain[id] ? 'Uncertain / retained' : 'No confident contradiction',
  note: changed.has(id) ? augmentFor(id).orientation_note! : family.has(id)
    ? 'Open-5 thumb-contact family: inward generic head palm replaced by non-dominant-side palm. Shared descriptor rule, not a sign-ID switch. Coordinator citation correction; https://www.lifeprint.com/asl101/pages-signs/p/parents.htm'
    : uncertain[id] ?? retained[id],
  phases: [.35, .55, .75].map(phase => ({ phase,
    ...motionFor(id, clipLengthMs(id) * phase / 1000).rightArm })),
}))
if (rows.some(r => !r.note)) throw new Error('Unreviewed top-50 entry')
const link = (s: string) => s.replace(/https:\/\/[^\s]+/g, url => `[citation](${url})`)
const table = rows.map(r => `| ${r.rank} | ${r.id} | ${r.frequency} | ${r.phases[1].palm?.map(v => v.toFixed(2)).join(', ')} | ${r.status} | ${link(r.note)} |`).join('\n')
const report = `# Top-50 frequency orientation review\n\nRanked by SignFrequency in data/asl_lex_params.json. Palm coordinates are signer right/up/forward, sampled at 55% of the isolated clip. Full three-phase requested poses are in top50-requested.json.\n\nThis is a citation-form desk review, not fluent-signer validation. The corrected cases had a specific contradiction supported by the coordinator or linked teaching references. Numerical solver accuracy does not validate a requested sign. Retained/uncertain entries are not certified correct.\n\nSource: FATHER had no accepted orientation prior and no custom orientation. Its inward palm came from ORIENTATION_BY_LOCATION.Head via orientationFor. The new narrowly scoped open-5 thumb-contact descriptor rule also changes matching morphemes in MOTHER, PARENTS, GRANDFATHER, MAN and WOMAN. ASL-LEX does not explicitly label the contacting digit; the inference and exclusions are documented in the data and tests.\n\nCustom orientations changed: ${[...changed].join(', ')}. Each has an orientation_note with provenance and limits.\n\nUncertain, retained for reference/variant review: ${Object.keys(uncertain).join(', ')}.\n\n| Rank | Sign | Frequency | Requested palm at 55% | Decision | Reason / source |\n|---:|---|---:|---|---|---|\n${table}\n`
await fs.writeFile('../artifacts/rig-verify/top50-requested.json', JSON.stringify(rows, null, 2))
await fs.writeFile('../artifacts/rig-verify/TOP50_REVIEW.md', report)
console.log('Reviewed', rows.length, 'custom corrections', changed.size, 'family entries', family.size, 'uncertain', Object.keys(uncertain).length)

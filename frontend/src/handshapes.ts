/**
 * Compositional handshape model.
 *
 * ASL-LEX names handshapes compositionally - `flat_b`, `curved_5`, `bent_v`,
 * `flatspread_5` - and codes Flexion, Spread, ThumbPosition, ThumbContact and
 * SelectedFingers as SEPARATE orthogonal columns. The previous implementation
 * collapsed all of that into one lookup table of 24 literal names, which meant
 * three consequences:
 *
 *   1. `closed_b`, `flat_b` and `b` resolved to byte-identical poses, as did
 *      `s` and `fist`. Distinct ASL handshapes rendered the same.
 *   2. 34 of the 58 handshapes ASL-LEX actually uses had no entry at all and
 *      silently fell back to a relaxed hand.
 *   3. Flexion, Spread, ThumbPosition, ThumbContact and SelectedFingers were
 *      extracted into data/asl_lex_params.json and then never read, because a
 *      single table key has nowhere to put them.
 *
 * This module composes a hand pose from a base form and a set of modifiers,
 * then refines it with the descriptor columns. That covers all 58 names plus
 * anything ASL-LEX adds later, and makes the orthogonal columns load-bearing.
 *
 * The structure follows HamNoSys, which specifies a handshape as base form x
 * thumb position x bending x deviations rather than as an opaque name.
 *
 * NOT VALIDATED ASL. A correct joint-angle decomposition of a published
 * descriptor is still an interpretation of that descriptor, and must be
 * reviewed by a qualified Deaf signer before it is called a translation.
 */

import { landmark, site, type ThumbSite } from './thumbIK'

/** MCP / PIP / DIP flexion in radians, plus abduction from the neighbouring finger. */
export type FingerPose = { curl: readonly [number, number, number]; spread: number }
/** Thumb has its own abduction, opposition rotation and two flexion joints.
 *  `site`, when present, places the thumb TIP by position instead (./thumbIK):
 *  the angle model cannot fold the Rocketbox thumb across the palm. */
export type ThumbPose = { abduct: number; rotate: number; curl: readonly [number, number]; site?: ThumbSite }
export type HandPose = { fingers: readonly FingerPose[]; thumb: ThumbPose }

/** index, middle, ring, pinky */
export type FingerIndex = 0 | 1 | 2 | 3
type Curl = readonly [number, number, number]

// ---------------------------------------------------------------------------
// Flexion profiles, keyed to the ASL-LEX `Flexion` vocabulary. These are the
// eight values that column actually takes across all 2,723 entries.
// ---------------------------------------------------------------------------
export const FLEXION: Record<string, Curl> = {
  FullyOpen:   [0, 0, 0],
  Flat:        [1.12, 0.05, 0.02],   // bent at the knuckle only
  Bent:        [0.42, 0.78, 0.36],   // knuckle straight, curved beyond it
  Curved:      [0.72, 0.95, 0.44],
  FullyClosed: [1.30, 1.42, 0.62],   // inside conservative joint limits
  Stacked:     [1.22, 1.38, 0.50],   // folded under the thumb
  Crossed:     [0.22, 0.34, 0.16],   // crossing is lateral; see `crossed`
}
const STACKED = FLEXION.Stacked

/** Thumb roles. `rotate` is opposition across the palm. */
export const THUMB = {
  open:      { abduct: 0.62, rotate: 0.18, curl: [0.08, 0.06] },
  closed:    { abduct: 0.14, rotate: 0.78, curl: [0.58, 0.52] },
  opposed:   { abduct: 0.34, rotate: 1.02, curl: [0.62, 0.40] },
  extended:  { abduct: 0.98, rotate: 0.06, curl: [0.0, 0.0] },
  tucked:    { abduct: 0.10, rotate: 0.90, curl: [0.75, 0.60] },
  /** Across the front of a closed fist, as in S. */
  across:    { abduct: 0.20, rotate: 0.86, curl: [0.70, 0.30] },
  /** Between index and middle, as in T; between middle and ring for N, etc. */
  between:   { abduct: 0.26, rotate: 0.94, curl: [0.52, 0.34] },
  /** Alongside a fist, pad forward, as in A. */
  alongside: { abduct: 0.30, rotate: 0.30, curl: [0.18, 0.12] },
} satisfies Record<string, ThumbPose>

export type ThumbRole = keyof typeof THUMB

// ---------------------------------------------------------------------------
// Base forms. `selected` lists the fingers the handshape is built on; every
// other finger takes `unselected` flexion. This mirrors the ASL-LEX
// SelectedFingers column (imrp / i / im / t / m / p / ip / mrp / mr / imr /
// imp / r).
// ---------------------------------------------------------------------------
type BaseForm = {
  selected: readonly FingerIndex[]
  thumb: ThumbRole
  /** Default flexion for the selected fingers. */
  flexion?: keyof typeof FLEXION
  /** Flexion for everything not selected. */
  unselected?: keyof typeof FLEXION
  /** Abduction magnitude spread across the selected fingers. */
  spread?: number
  /** Selected finger whose tip meets the thumb pad. */
  contact?: FingerIndex
  /** Index crosses over middle (R). */
  crossed?: boolean
  /** Selected fingers sit at descending heights (3, stacked_5). */
  staircase?: boolean
  /** Fingers angle away from vertical rather than pointing up. */
  angled?: number
  /** How many fingers fold OVER the thumb: M is three, N is two, T is one. */
  thumbUnder?: 1 | 2 | 3
}

const ALL: readonly FingerIndex[] = [0, 1, 2, 3]

export const BASE_FORMS: Record<string, BaseForm> = {
  // --- all four fingers ---------------------------------------------------
  b:  { selected: ALL, thumb: 'closed', flexion: 'FullyOpen', spread: 0 },
  '5': { selected: ALL, thumb: 'extended', flexion: 'FullyOpen', spread: 0.30 },
  '4': { selected: ALL, thumb: 'tucked', flexion: 'FullyOpen', spread: 0.26 },
  e:  { selected: ALL, thumb: 'opposed', flexion: 'Bent', spread: 0, contact: 0 },
  c:  { selected: ALL, thumb: 'open', flexion: 'Curved', spread: 0.05 },
  o:  { selected: ALL, thumb: 'opposed', flexion: 'Curved', spread: 0, contact: 0 },

  // --- fist family. These differ ONLY in the thumb, which is exactly what
  //     distinguishes them in ASL, so the thumb role carries the contrast. ---
  a:  { selected: [], thumb: 'alongside', unselected: 'FullyClosed' },
  s:  { selected: [], thumb: 'across',    unselected: 'FullyClosed' },
  t:  { selected: [], thumb: 'between',   unselected: 'FullyClosed', thumbUnder: 1 },
  m:  { selected: [], thumb: 'between',   unselected: 'Stacked', thumbUnder: 3 },
  n:  { selected: [], thumb: 'between',   unselected: 'Stacked', thumbUnder: 2 },

  // --- selected-finger family ---------------------------------------------
  '1': { selected: [0], thumb: 'tucked', flexion: 'FullyOpen' },
  d:  { selected: [0], thumb: 'opposed', flexion: 'FullyOpen', unselected: 'Curved', contact: 1 },
  i:  { selected: [3], thumb: 'tucked', flexion: 'FullyOpen' },
  h:  { selected: [0, 1], thumb: 'tucked', flexion: 'FullyOpen', spread: 0.03 },
  v:  { selected: [0, 1], thumb: 'tucked', flexion: 'FullyOpen', spread: 0.20 },
  r:  { selected: [0, 1], thumb: 'tucked', flexion: 'FullyOpen', crossed: true },
  k:  { selected: [0, 1], thumb: 'between', flexion: 'FullyOpen', spread: 0.18, angled: 0.30 },
  p:  { selected: [0, 1], thumb: 'between', flexion: 'FullyOpen', spread: 0.18, angled: 0.30 },
  w:  { selected: [0, 1, 2], thumb: 'tucked', flexion: 'FullyOpen', spread: 0.22 },
  '3': { selected: [0, 1], thumb: 'extended', flexion: 'FullyOpen', spread: 0.20 },
  '7': { selected: [0, 1, 3], thumb: 'opposed', flexion: 'FullyOpen', contact: 2 },

  // --- thumb-paired family ------------------------------------------------
  l:  { selected: [0], thumb: 'extended', flexion: 'FullyOpen' },
  g:  { selected: [0], thumb: 'open', flexion: 'Flat', angled: 0.85 },
  y:  { selected: [3], thumb: 'extended', flexion: 'FullyOpen', spread: 0.32 },
  horns: { selected: [0, 3], thumb: 'tucked', flexion: 'FullyOpen', spread: 0.30 },
  ily: { selected: [0, 3], thumb: 'extended', flexion: 'FullyOpen', spread: 0.30 },

  // --- thumb-contact family: a fingertip meets the thumb pad --------------
  f:  { selected: [1, 2, 3], thumb: 'opposed', flexion: 'FullyOpen', contact: 0 },
  '8': { selected: [0, 2, 3], thumb: 'opposed', flexion: 'FullyOpen', contact: 1 },
  baby_o: { selected: [0], thumb: 'opposed', flexion: 'Bent', contact: 0 },
  goody_goody: { selected: [0, 1], thumb: 'opposed', flexion: 'Bent', spread: 0.16, contact: 0 },
}

/** Modifier tokens that may prefix a base name. */
const MODIFIERS = new Set(['flat', 'curved', 'bent', 'open', 'closed', 'spread', 'stacked'])
/** Modifier tokens written without a separator. */
const COMPOUND_MODIFIERS: Record<string, readonly string[]> = {
  flatspread: ['flat', 'spread'],
}
/** Names whose underscore is part of the base, not a modifier boundary. */
const ATOMIC = new Set(['baby_o', 'goody_goody'])

export type ParsedHandshape = { base: string; modifiers: readonly string[] }

/**
 * Split an ASL-LEX handshape name into its base form and modifiers.
 * `flatspread_5` -> { base: '5', modifiers: ['flat', 'spread'] }
 * `spread_open_e` -> { base: 'e', modifiers: ['spread', 'open'] }
 */
export function parseHandshapeName(raw: string): ParsedHandshape {
  const name = raw.trim().toLowerCase()
  if (ATOMIC.has(name)) return { base: name, modifiers: [] }
  const tokens = name.split('_')
  const base = tokens[tokens.length - 1]
  const modifiers: string[] = []
  for (const token of tokens.slice(0, -1)) {
    if (MODIFIERS.has(token)) modifiers.push(token)
    else if (COMPOUND_MODIFIERS[token]) modifiers.push(...COMPOUND_MODIFIERS[token])
    // An unrecognised prefix is dropped rather than guessed at; the audit
    // reports it so the vocabulary gap stays visible.
  }
  return { base, modifiers }
}

/** Flexion a modifier imposes on the selected fingers, if any. */
const MODIFIER_FLEXION: Record<string, keyof typeof FLEXION> = {
  flat: 'Flat',
  curved: 'Curved',
  bent: 'Bent',
  closed: 'FullyClosed',
}

const f = (curl: Curl, spread = 0): FingerPose => ({ curl, spread })

/** Even abduction across a set of fingers, centred on zero. */
function spreadOf(selected: readonly FingerIndex[], magnitude: number, index: FingerIndex): number {
  if (magnitude === 0 || selected.length < 2) return 0
  const position = selected.indexOf(index)
  if (position < 0) return 0
  const centre = (selected.length - 1) / 2
  return ((position - centre) / centre) * magnitude
}

/**
 * The Rocketbox rest pose already fans the fingers slightly, so a B-family
 * shape needs a small inward counter-spread to read as fingers together.
 */
const REST_FAN: readonly number[] = [0.055, 0.018, -0.018, -0.055]

export type HandshapeDescriptors = {
  Flexion?: string | null
  Spread?: string | null
  ThumbPosition?: string | null
  ThumbContact?: string | null
  SelectedFingers?: string | null
}

const SELECTED_FINGERS: Record<string, readonly FingerIndex[]> = {
  imrp: [0, 1, 2, 3],
  imr: [0, 1, 2],
  imp: [0, 1, 3],
  im: [0, 1],
  ip: [0, 3],
  i: [0],
  m: [1],
  mr: [1, 2],
  mrp: [1, 2, 3],
  r: [2],
  p: [3],
  t: [],           // thumb only
}

/**
 * Compose a hand pose from a handshape name, then refine it with the
 * orthogonal ASL-LEX descriptor columns.
 *
 * Precedence is deliberate: the base form establishes the shape, modifiers in
 * the NAME refine it, and the separate descriptor COLUMNS refine it further.
 * A column never silently contradicts an explicit modifier - `flat_b` with
 * Flexion=Flat agrees, and `flat_b` with Flexion=FullyOpen keeps the name's
 * Flat, because the name is the more specific statement about this sign.
 */
export function composeHandshape(
  name: string | null | undefined,
  descriptors: HandshapeDescriptors = {},
): HandPose {
  if (!name) return RELAXED
  const { base, modifiers } = parseHandshapeName(name)
  const form = BASE_FORMS[base]
  if (!form) return RELAXED

  // --- which fingers are selected ----------------------------------------
  const columnSelected = descriptors.SelectedFingers
    ? SELECTED_FINGERS[descriptors.SelectedFingers.trim().toLowerCase()]
    : undefined
  // The base form wins: SelectedFingers describes the same shape, and where the
  // two disagree the name is the more specific record. The column is used only
  // when the base form does not commit to a finger set.
  const selected = form.selected.length || !columnSelected ? form.selected : columnSelected

  // --- flexion ------------------------------------------------------------
  // On B, `closed` names the thumb (folded across the palm), not the fingers:
  // ASL-LEX closed_b is the ordinary straight B. Reading it as FullyClosed
  // turned HELLO and 60+ other closed_b entries into a fist.
  const namedFlexion = modifiers
    .filter((m) => !(base === 'b' && m === 'closed'))
    .map((m) => MODIFIER_FLEXION[m]).find(Boolean)
  const columnFlexion = descriptors.Flexion && descriptors.Flexion !== 'NA'
    ? descriptors.Flexion.trim()
    : undefined
  const flexionKey = namedFlexion ?? form.flexion ?? columnFlexion ?? 'FullyOpen'
  const selectedCurl = FLEXION[flexionKey] ?? FLEXION.FullyOpen
  const unselectedCurl = FLEXION[form.unselected ?? 'Stacked'] ?? STACKED

  // --- spread -------------------------------------------------------------
  let magnitude = form.spread ?? 0
  if (modifiers.includes('spread')) magnitude = Math.max(magnitude, 0.26)
  // Spread is coded 0 / 1 / NA. A coded 1 opens a shape the base form keeps
  // closed; a coded 0 closes one the base form spreads.
  if (modifiers.includes('open') && form.contact === undefined) magnitude = Math.max(magnitude, 0.13)
  if (descriptors.Spread === '1') magnitude = Math.max(magnitude, 0.24)
  else if (descriptors.Spread === '0' && !modifiers.includes('spread')) magnitude = Math.min(magnitude, 0.06)

  // --- thumb --------------------------------------------------------------
  let thumbRole: ThumbRole = form.thumb
  // ThumbPosition is coded Open / Closed and never NA. Only shift a thumb whose
  // base role is one of the neutral pair; a structural role (between, opposed,
  // alongside, across) is part of the handshape's identity.
  if (thumbRole === 'open' || thumbRole === 'closed' || thumbRole === 'extended') {
    if (descriptors.ThumbPosition === 'Closed' && thumbRole !== 'extended') thumbRole = 'closed'
    else if (descriptors.ThumbPosition === 'Open' && thumbRole === 'closed') thumbRole = 'open'
  }
  if (modifiers.includes('open') && thumbRole === 'closed') thumbRole = 'open'
  if (modifiers.includes('closed') && thumbRole === 'open') thumbRole = 'closed'
  // On a contact shape, `open` means the fingertip comes OFF the thumb pad -
  // that is the whole contrast between F and open_F, and 8 and open_8. On a
  // shape with no contact it means the selected fingers sit apart, which is the
  // contrast between H and open_H.
  const releaseContact = modifiers.includes('open') && form.contact !== undefined
  // ThumbContact=1 means the thumb pad meets a finger; force opposition.
  const contactCoded = descriptors.ThumbContact === '1'
  if (contactCoded && form.contact === undefined && thumbRole !== 'between') thumbRole = 'opposed'
  const thumb: ThumbPose = { ...THUMB[thumbRole] }

  // --- build --------------------------------------------------------------
  const fingers: FingerPose[] = []
  for (let i = 0 as FingerIndex; i < 4; i = (i + 1) as FingerIndex) {
    const isSelected = selected.includes(i)
    let curl = isSelected ? selectedCurl : unselectedCurl
    // A staircase shape steps its selected fingers down rather than holding
    // them level; `stacked_5` and `3` read as a staircase, not a flat fan.
    if (isSelected && (form.staircase || modifiers.includes('stacked'))) {
      const step = selected.indexOf(i) * 0.22
      curl = [curl[0] + step, curl[1] + step * 0.7, curl[2] + step * 0.4] as Curl
    }
    // Fingers that fold over the thumb curl deeper than the rest, which is
    // what separates M (three over) from N (two) and T (one).
    if (form.thumbUnder !== undefined && i < form.thumbUnder) {
      curl = [Math.max(curl[0], 1.24), Math.max(curl[1], 1.30), Math.max(curl[2], 0.48)] as Curl
    }
    // The contacting finger curls toward the opposed thumb, unless `open` has
    // lifted it off the pad.
    // F, 8 and 7 list their contact finger outside `selected`, so it must be
    // SET here, not maxed against the unselected fold - otherwise it tucks into
    // the palm and the circle never closes. `open` (open_8, open_f) lifts it off
    // the pad bent at the knuckle, which is how ASL-LEX codes it (Flexion=Flat).
    if (form.contact === i) {
      if (releaseContact) curl = [1.05, 0.30, 0.12]
      else if (isSelected) curl = [Math.max(curl[0], 0.62), Math.max(curl[1], 0.78), Math.max(curl[2], 0.30)] as Curl
      else curl = [0.62, 0.78, 0.30]
    }
    let spread = spreadOf(selected, magnitude, i) + (magnitude === 0 ? REST_FAN[i] : 0)
    // R crosses index over middle: equal and opposite abduction, no gap.
    if (form.crossed && (i === 0 || i === 1)) spread = i === 0 ? 0.17 : -0.19
    fingers.push(f(curl, spread))
  }

  // The more fingers cover the thumb, the further across the palm it sits.
  if (form.thumbUnder !== undefined) {
    thumb.rotate = 0.82 + form.thumbUnder * 0.06
    thumb.abduct = 0.30 - form.thumbUnder * 0.06
    thumb.curl = [0.44 + form.thumbUnder * 0.05, 0.30] as const
  }
  // A contacting base form has its contact finger meet the thumb, so the thumb
  // needs enough opposition to actually reach it. A released contact keeps the
  // thumb opposed but withdrawn, which is what open_F and open_8 look like.
  if (form.contact !== undefined) {
    thumb.rotate = releaseContact ? 0.70 : Math.max(thumb.rotate, 0.92)
    thumb.abduct = releaseContact ? 0.58 : Math.min(thumb.abduct, 0.42)
  }

  const tipSite = thumbSiteFor(thumbRole, form, fingers, releaseContact)
  if (tipSite) thumb.site = tipSite
  return { fingers, thumb }
}

/**
 * Where the thumb tip sits for each role, as a blend of the hand's own joints
 * so it follows the fingers. Verified on the rig: residual 0.05-0.5 palm
 * widths, against 0.8-2.2 for the angle model. Open/extended thumbs keep the
 * angle model, which already renders them correctly.
 */
function thumbSiteFor(role: ThumbRole, form: BaseForm, fingers: readonly FingerPose[],
  releaseContact: boolean): ThumbSite | undefined {
  const curled = (i: FingerIndex) => fingers[i].curl[0] + fingers[i].curl[1] > 1.2
  // Folded across the palm toward the ring-finger base (B, 4).
  const palm = site([[landmark(1, 0), 0.35], [landmark(2, 0), 0.35], [0, 0.3]], 0.15)
  switch (role) {
    case 'closed':
    case 'tucked':
      // Over the curled middle finger (1, H, V, I) or into the palm (B, 4).
      return curled(1) ? site([[landmark(1, 1), 0.5], [landmark(1, 2), 0.5]], 0.1) : palm
    case 'across':
      return site([[landmark(0, 1), .25], [landmark(0, 2), .25], [landmark(1, 1), .25], [landmark(1, 2), .25]], 0.15)
    case 'between': {
      // T under the index, N under index+middle, M under three fingers.
      const u = Math.min(3, Math.max(1, form.thumbUnder ?? 1)) as 1 | 2 | 3
      return site([[landmark((u - 1) as FingerIndex, 1), 0.5], [landmark(u, 1), 0.5]], 0.02)
    }
    case 'alongside':
      return site([[landmark(0, 1), 1]], 0.02, 0.3)
    case 'opposed': {
      const k = form.contact ?? 0
      // E tucks the thumb under the bent fingertips; open_8 / open_F hold it
      // off the pad rather than letting it drift.
      if (form.flexion === 'Bent' && k === 0 && form.selected.length === 4) {
        return site([[landmark(0, 3), .5], [landmark(1, 3), .5]], -0.05)
      }
      return site([[landmark(k, 3), 1]], releaseContact ? 0.35 : 0.03)
    }
    default:
      return undefined
  }
}

const RELAXED: HandPose = {
  fingers: [
    f([0.24, 0.34, 0.20], -0.06), f([0.26, 0.38, 0.22], -0.02),
    f([0.30, 0.42, 0.24], 0.02), f([0.34, 0.46, 0.26], 0.08),
  ],
  thumb: { abduct: 0.36, rotate: 0.30, curl: [0.24, 0.20] },
}
export { RELAXED }

/**
 * The 58 handshape names ASL-LEX actually uses, for the audit and the contact
 * sheet. Composed, not hand-written, so the list cannot drift from the model.
 */
export const ASL_LEX_HANDSHAPES: readonly string[] = [
  '1', 'open_b', 's', 'a', 'curved_5', '5', 'baby_o', 'c', 'f', 'flat_b', 'o',
  'h', 'closed_b', 'v', 'open_8', 'bent_1', 'p', 'y', 'flat_o', 'l',
  'flatspread_5', 'g', 'bent_v', '4', 'r', 'curved_v', 'i', 'curved_l',
  'flat_1', 'flat_h', '3', 'd', '8', 'bent_l', 'w', 'e', 'horns', 'flat_v',
  'spread_open_e', 'open_h', 'stacked_5', 'curved_1', 'ily', 'flat_m',
  'open_e', 'flat_n', 'curved_h', 'flat_horns', 'curved_4', 'flat_4',
  'open_f', 'goody_goody', 't', '7', 'spread_e', 'flat_ily', 'closed_e', 'k',
]

/**
 * Backwards-compatible named table. Every entry is now COMPOSED, so shapes
 * that used to collide - closed_b / flat_b / b, and s / fist - no longer do.
 */
export const HANDSHAPES: Record<string, HandPose> = Object.fromEntries([
  ...ASL_LEX_HANDSHAPES.map((name) => [name, composeHandshape(name)] as const),
  // Aliases the app's own catalog uses.
  ['b', composeHandshape('b')],
  ['fist', composeHandshape('s')],
  ['x', composeHandshape('bent_1')],
  ['u', composeHandshape('h')],
])

/**
 * Names the app's own catalog and the ASL-LEX NonDominantHandshape column use
 * that are not ASL-LEX dominant-handshape names.
 */
const ALIASES: Record<string, string> = {
  fist: 's',
  x: 'bent_1',   // ASL-LEX writes the X handshape as bent_1
  u: 'h',        // U and H are the same handshape, distinguished by orientation
  lax: '5',      // NonDominantHandshape "Lax" is a relaxed open hand
  curved_b: 'curved_b',
  na: '',
}

export function handshapeFor(
  name: string | null | undefined,
  descriptors?: HandshapeDescriptors,
): HandPose {
  if (!name) return RELAXED
  const key = name.trim().toLowerCase()
  // ASL-LEX writes these in the NonDominantHandshape column instead of a shape.
  if (key === 'na' || key.endsWith('violation')) return RELAXED
  // Aliases first, then composition, so 'fist' and 'x' keep resolving.
  if (!descriptors && HANDSHAPES[key]) return HANDSHAPES[key]
  const alias = ALIASES[key]
  if (alias === '') return RELAXED
  return composeHandshape(alias ?? key, descriptors)
}

// ---------------------------------------------------------------------------
// Manual alphabet.
//
// The previous map resolved 26 letters onto 13 distinct poses: D, G, L, Q and Z
// all rendered as `1`; M, N and T as `t`; H, R and U as `h`; K, P and V as `v`;
// I, J and Y as `y`; E and O as `o`. Nineteen of twenty-six letters were
// ambiguous, on the code path that renders EVERY unsupported word.
//
// Each letter now carries its own handshape plus the palm and pointing
// direction that distinguishes it. Directions are in the normalised body frame
// used by ./anchors: +x toward the dominant hand, +y up, +z forward (toward the
// person being addressed).
// ---------------------------------------------------------------------------
export type Vec3 = readonly [number, number, number]
export type LetterForm = {
  shape: string
  palm: Vec3
  point: Vec3
  /** Letters drawn with a path rather than held. */
  trace?: 'hook' | 'zigzag'
}

const OUT: Vec3 = [0, 0, 1]        // palm toward the addressee
const ACROSS: Vec3 = [-0.92, 0, 0.39] // palm toward the non-dominant side
const DOWN: Vec3 = [0, -1, 0]
const UP: Vec3 = [0, 1, 0]
const LATERAL: Vec3 = [-0.94, 0.12, 0.32] // fingers point across the body
/** Palm toward the signer, perpendicular to LATERAL. */
const FACING_SIGNER: Vec3 = [-0.32, 0.04, -0.95]

export const FINGERSPELL: Record<string, LetterForm> = {
  A: { shape: 'a',      palm: OUT,    point: UP },
  B: { shape: 'b',      palm: OUT,    point: UP },
  C: { shape: 'c',      palm: ACROSS, point: UP },
  D: { shape: 'd',      palm: OUT,    point: UP },
  E: { shape: 'e',      palm: OUT,    point: UP },
  F: { shape: 'f',      palm: OUT,    point: UP },
  // G and Q share a handshape; G points across, Q points down.
  // G and H point across the body with the palm toward the signer. They were
  // coded palm ACROSS / point LATERAL - almost the same vector (cos 0.99), so
  // the finger direction was undefined and the hand flipped entering any word
  // with G or H (HALF, THURSDAY, HIGH_SCHOOL: 67 rad/s).
  G: { shape: 'g',      palm: FACING_SIGNER, point: LATERAL },
  // H and U share a handshape; H is horizontal, U is vertical.
  H: { shape: 'h',      palm: FACING_SIGNER, point: LATERAL },
  I: { shape: 'i',      palm: OUT,    point: UP },
  J: { shape: 'i',      palm: OUT,    point: UP, trace: 'hook' },
  K: { shape: 'k',      palm: OUT,    point: UP },
  L: { shape: 'l',      palm: OUT,    point: UP },
  // `point` is the back of the hand (wrist -> knuckles), not the fingertips.
  // M and N are upright like A/S/T; the fingers' drape over the thumb comes
  // from the flat_m/flat_n handshape. Coded DOWN, N->O was a 180-degree flip.
  M: { shape: 'flat_m', palm: OUT,    point: UP },
  N: { shape: 'flat_n', palm: OUT,    point: UP },
  O: { shape: 'o',      palm: ACROSS, point: UP },
  // P is K tipped forward-down; Q is G pointing down, palm toward the signer.
  // Both were coded palm DOWN / point DOWN - parallel, so the finger direction
  // was undefined and toggled 90 degrees between frames (#OPPORTUNITY).
  P: { shape: 'p',      palm: [0, -0.87, -0.5], point: [0, -0.5, 0.87] },
  Q: { shape: 'g',      palm: [0, 0, -1],       point: DOWN },
  R: { shape: 'r',      palm: OUT,    point: UP },
  S: { shape: 's',      palm: OUT,    point: UP },
  T: { shape: 't',      palm: OUT,    point: UP },
  U: { shape: 'h',      palm: OUT,    point: UP },
  V: { shape: 'v',      palm: OUT,    point: UP },
  W: { shape: 'w',      palm: OUT,    point: UP },
  X: { shape: 'bent_1', palm: OUT,    point: UP },
  Y: { shape: 'y',      palm: OUT,    point: UP },
  Z: { shape: '1',      palm: OUT,    point: UP, trace: 'zigzag' },
  // Digits share the cardinal handshapes.
  '1': { shape: '1', palm: OUT, point: UP },
  '2': { shape: 'v', palm: OUT, point: UP },
  '3': { shape: '3', palm: OUT, point: UP },
  '4': { shape: '4', palm: OUT, point: UP },
  '5': { shape: '5', palm: OUT, point: UP },
  '6': { shape: 'w', palm: ACROSS, point: UP },
  '7': { shape: '7', palm: OUT, point: UP },
  '8': { shape: '8', palm: OUT, point: UP },
  '9': { shape: 'f', palm: OUT, point: UP },
  '0': { shape: 'o', palm: ACROSS, point: UP },
}

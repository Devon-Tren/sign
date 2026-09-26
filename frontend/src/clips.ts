/**
 * Pose composition for the illustrative avatar.
 *
 * Motion is composed from ASL-LEX 2.0 phonological descriptors
 * (data/asl_lex_params.json, CC BY-NC 4.0 - see data/LICENSE and NOTICE)
 * rather than hand-invented joint angles. Handshapes are composed in
 * ./handshapes, locations and two-handed relations in ./anchors, and this
 * module sequences them over time. Consensus-gated ASL-Phono estimates
 * (CC BY 4.0) fill eligible palm and local movement-direction gaps.
 *
 * THIS IS STILL NOT VALIDATED ASL. ASL-LEX describes signs; it is not an
 * animation specification. Turning "Curved movement at Head/Mouth" into a
 * trajectory is interpretation, and the result must be reviewed by a
 * qualified Deaf signer before it is called a translation.
 */
import params from '../../data/asl_lex_params.json'
import customParams from '../../data/asl_custom_motions.json'
import { acceptedDirection, phonoPriorFor, pointForPalm, type PhonoPrior } from './phono'
import { authoredClipFor, authoredSequenceFor, type AuthoredFrame } from './authored'
import { sampleSequence } from './sequence'
import {
  FINGERSPELL, HANDSHAPES, RELAXED, handshapeFor,
  type FingerPose, type HandPose, type ThumbPose,
} from './handshapes'
import {
  ANCHORS, ELBOW_BY_LOCATION, NON_DOMINANT_REST,
  anchor, isHandLocated, orientationFor, relationFor,
} from './anchors'

export type ClipId = string
export type Vec3 = readonly [number, number, number]
export type { FingerPose, ThumbPose, HandPose }
export { HANDSHAPES, handshapeFor }

/**
 * `palm` is the direction the palm faces; `point` is the direction the
 * fingers point. Palm orientation is one of the five classical ASL
 * parameters but is NOT among the ASL-LEX columns extracted here, so these
 * values are an authored/derived layer or a consensus-gated ASL-Phono estimate.
 */
export type ArmPose = {
  target: Vec3
  palm: Vec3
  point: Vec3
  /** Preferred elbow plane in body space. A signer's elbow path is part of the
   *  motion; one global IK pole makes every arm share the same mannequin angle. */
  elbow?: Vec3
  /** Rare sign-specific extension/deviation allowance. The default remains a
   *  conservative 55 degrees; support palms sometimes need slightly more. */
  wristMax?: number
  /** ASL-LEX Contact=1. The renderer keeps approximate targets off the torso;
   *  a sign that genuinely touches the body must be allowed to reach it. */
  contact?: boolean
}

export type Pose = {
  rightArm: ArmPose | null
  leftArm: ArmPose | null
  rightHand: HandPose
  leftHand: HandPose
  head: Vec3
  torso: number
  /** Non-manual markers. Brow raise marks yes/no questions in ASL; brow
   *  furrow marks WH-questions. Kept separate because they are not opposites. */
  browRaise: number
  browFurrow: number
  mouth: number
  /** Side-to-side head shake. Negation in ASL is marked on the head, not the
   *  hands, so a sign like NO or NOT is incomplete without it. */
  headShake: number
}

const DEFAULT_WRIST_MAX = 0.96

// ---------------------------------------------------------------------------
// Descriptor records
// ---------------------------------------------------------------------------
/** One coded morpheme. ASL-LEX codes up to six per sign. */
export type Morpheme = {
  Handshape: string | null
  SelectedFingers?: string | null
  Flexion?: string | null
  FlexionChange?: string | null
  Spread?: string | null
  SpreadChange?: string | null
  ThumbPosition?: string | null
  ThumbContact?: string | null
  SignType: string | null
  Movement: string | null
  RepeatedMovement: string | null
  MajorLocation: string | null
  MinorLocation: string | null
  SecondMinorLocation: string | null
  Contact?: string | null
  NonDominantHandshape: string | null
  UlnarRotation?: string | null
}

export type SignParams = Morpheme & {
  asl_lex_entry?: string
  asl_lex_lemma_id?: string
  fidelity?: string
  mapping_note?: string | null
  duration_ms: number | null
  app_authored?: boolean
  Compound?: string | null
  NumberOfMorphemes?: string | null
  /** Noun / Verb / Adjective / Adverb / Minor / Name / Number. */
  LexicalClass?: string | null
  /** The sign is a lexicalised fingerspelling (#BANK, #OK) rather than a pose. */
  FingerspelledLoanSign?: string | null
  Initialized?: string | null
  SignFrequency?: number | null
  morphemes?: Morpheme[]
}

/** App-authored values layered on top of the licensed descriptors. */
export type Augment = {
  nonmanual?: {
    browRaise?: number
    browFurrow?: number
    mouth?: number
    headShake?: number
    head?: Vec3
  }
  repeat_count?: number
  movement_size?: number
  movement_axis?: 'vertical' | 'lateral' | 'forward'
  hand_relation?: string
  carried?: boolean
  /** Palm and finger direction at the START of the sign. ASL-LEX does not code
   *  palm orientation at all, so this is authored, and it overrides the
   *  derivation in ./anchors for signs whose presentation is distinctive. */
  orientation?: { palm: Vec3; point: Vec3 }
  /** Orientation at the END, when the sign rotates as it travels. */
  orientation_end?: { palm: Vec3; point: Vec3 }
  orientation_note?: string
}

const LEX = (params as { signs: Record<string, SignParams> }).signs
const CUSTOM = (customParams as { signs: Record<string, SignParams> }).signs
// JSON literals widen [0.05, 0, 0] to number[], so the tuple types in Augment
// need the cast to go through unknown. The shape is checked by the audit and
// by backend/tests/test_motion_data.py rather than by the compiler here.
const AUGMENT = ((customParams as unknown) as { augment: Record<string, Augment> }).augment ?? {}

/**
 * Licensed descriptors take precedence. The app-authored block now holds only
 * the ids that have no plausible ASL-LEX lemma, so the merge order is: start
 * from app-authored, then let the extract overwrite anything it covers.
 */
const SIGNS: Record<string, SignParams> = { ...CUSTOM, ...LEX }

export function isParameterised(id: string): boolean {
  return id in SIGNS || id.startsWith('fs:')
}
export function signParams(id: string): SignParams | null {
  return SIGNS[id] ?? null
}
export function augmentFor(id: string): Augment {
  return AUGMENT[id] ?? {}
}
export function allSignIds(): string[] {
  return Object.keys(SIGNS).sort()
}

/** Morphemes for a sign, always at least one. */
function morphemesOf(sign: SignParams): Morpheme[] {
  if (sign.morphemes && sign.morphemes.length) return sign.morphemes
  return [sign]
}

// ---------------------------------------------------------------------------
// Timing.
//
// ASL-LEX citation durations are short (334-1134 ms) because they are isolated
// elicitations. How much to stretch them depends on what the clip is FOR, and
// the published corpora give two different answers:
//
//   Isolated display (Learning Studio). SignAvatars' isolated subsets run ~57
//   frames (Word2Motion) and ~60 frames (HamNoSys) at 24 fps, i.e. roughly
//   2.4-2.5 s per sign including rest padding. A citation form stretched ~2.1x
//   lands inside that window.
//
//   Connected signing (Classroom). SignAvatars' Language2Motion subset runs
//   ~162 frames at 24 fps for a multi-sign sequence - about 6.75 s. Packed with
//   five to seven signs that is ~1.0-1.35 s each, close to citation form rather
//   than 2.1x slower. One global stretch made the live avatar wade.
//
// Legibility is bought by extending the HOLD, not by slowing the stroke. A slow
// stroke reads as an underwater avatar; a normal stroke with a longer hold reads
// as clear signing, because the hold is the part the eye actually reads.
// ---------------------------------------------------------------------------
export type TimingMode = 'isolated' | 'continuous'

/** Transitions in human signing are roughly constant, not proportional to the
 *  sign's length. Fractional onset/release made a long clip drift to neutral
 *  for nearly 400 ms. */
const ONSET_MS = 170
const RELEASE_MS = 200
/** Travel time cap. Past this the sign has arrived and the rest is hold. */
const STROKE_MAX_MS = 520
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clipLengthMs(id: string, mode: TimingMode = 'isolated'): number {
  if (id === 'idle') return 2600
  const sequence = authoredSequenceFor(id)
  if (sequence) return sequence.clips.reduce((sum, child) => sum + clipLengthMs(child, mode), 0)
  const authored = authoredClipFor(id)
  if (authored) return authored.duration_ms[mode]
  const citation = SIGNS[id]?.duration_ms ?? 600
  return mode === 'continuous'
    ? Math.round(clamp(citation * 1.15, 700, 1400))
    : Math.round(clamp(citation * 2.1, 1250, 2500))
}

/** Isolated-display lengths, kept as a table for existing callers. */
export const CLIP_LENGTH_MS: Record<string, number> = Object.fromEntries(
  Object.keys(SIGNS).map((id) => [id, clipLengthMs(id, 'isolated')]),
)
CLIP_LENGTH_MS.idle = 2600
CLIP_LENGTH_MS.artificial_intelligence = 2350

/** Connected-signing lengths, for the live playback queue. */
export const CONTINUOUS_LENGTH_MS: Record<string, number> = Object.fromEntries(
  Object.keys(SIGNS).map((id) => [id, clipLengthMs(id, 'continuous')]),
)

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const mix = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const mirror = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]

const normalise = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** Spherical interpolation for directions. Linear interpolation can pass
 * through [0,0,0] when two palm normals oppose one another, leaving the wrist
 * basis undefined for a frame and producing a dramatic flip. */
const slerpDirection = (from: Vec3, to: Vec3, t: number): Vec3 => {
  const a = normalise(from), b = normalise(to)
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  if (dot > 0.9995) return normalise(mix(a, b, t))
  if (dot < -0.9995) {
    // There are infinitely many paths between opposite vectors. Select a
    // stable perpendicular based on the smallest component of the source.
    const seed: Vec3 = Math.abs(a[0]) < Math.abs(a[1])
      ? (Math.abs(a[0]) < Math.abs(a[2]) ? [1, 0, 0] : [0, 0, 1])
      : (Math.abs(a[1]) < Math.abs(a[2]) ? [0, 1, 0] : [0, 0, 1])
    const perpendicular = normalise([
      a[1] * seed[2] - a[2] * seed[1],
      a[2] * seed[0] - a[0] * seed[2],
      a[0] * seed[1] - a[1] * seed[0],
    ])
    const angle = Math.PI * t
    return normalise([
      a[0] * Math.cos(angle) + perpendicular[0] * Math.sin(angle),
      a[1] * Math.cos(angle) + perpendicular[1] * Math.sin(angle),
      a[2] * Math.cos(angle) + perpendicular[2] * Math.sin(angle),
    ])
  }
  const angle = Math.acos(dot)
  const sin = Math.sin(angle)
  const wa = Math.sin((1 - t) * angle) / sin
  const wb = Math.sin(t * angle) / sin
  return normalise([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb])
}

/** Minimum-jerk interpolation: zero velocity and acceleration at both ends. */
const easeInOut = (t: number) => {
  const p = clamp(t, 0, 1)
  return p * p * p * (p * (p * 6 - 15) + 10)
}

// ---------------------------------------------------------------------------
// Movement primitives.
//
// A descriptor names the path FAMILY, not its scale or its axis. ASL-LEX has no
// size column, so amplitude used to be a hardcoded constant per family plus a
// per-sign escape hatch for five ids. HamNoSys carries movement size,
// repetition count and direction as first-class fields, so those are now read
// from the `augment` block instead of being compiled in.
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2

/** Base amplitude per family, before the per-sign size multiplier. */
const MOVEMENT_SCALE: Record<string, number> = {
  Straight: 0, Curved: 0.075, Circular: 0.085, BackAndForth: 0.075,
  'Z-shaped': 0.095, 'X-shaped': 0.09, None: 0.009, Other: 0.02,
}

function movementOffset(
  kind: string | null | undefined,
  phase: number,
  size: number,
  axis?: Augment['movement_axis'],
): Vec3 {
  const p = phase
  const k = (MOVEMENT_SCALE[kind ?? 'Straight'] ?? 0) * size
  if (k === 0) return [0, 0, 0]
  // An explicit axis constrains the primitive to one direction. This is what
  // the old per-id overrides were expressing: YES nods vertically, BATHROOM
  // shakes laterally, THANK YOU travels forward.
  if (axis) {
    const amount = Math.sin(p * (kind === 'Circular' || kind === 'BackAndForth' ? TAU : Math.PI)) * k
    if (axis === 'vertical') return [0, amount, 0]
    if (axis === 'lateral') return [amount, 0, 0]
    return [0, amount * 0.45, amount]
  }
  switch (kind) {
    case 'Straight':     return [0, 0, 0]
    case 'Curved':       return [0, Math.sin(p * Math.PI) * k, Math.sin(p * Math.PI) * k * 0.67]
    case 'Circular':     return [Math.cos(p * TAU) * k, Math.sin(p * TAU) * k, 0]
    case 'BackAndForth': return [0, 0, Math.sin(p * TAU) * k]
    case 'Z-shaped':     return [Math.sin(p * TAU * 1.5) * k, Math.cos(p * TAU) * k * 0.47 - k * 0.47, 0]
    case 'X-shaped':     return [Math.sin(p * TAU) * k, Math.sin(p * TAU * 2) * k * 0.72, 0]
    case 'None':         return [0, Math.sin(p * TAU) * k, 0]
    default:             return [0, 0, 0]
  }
}

/**
 * Default movement size by location. A sign at the face has less room than one
 * in neutral space, so a single global amplitude over-travels at the head and
 * under-travels in front of the body.
 */
function defaultSize(major: string | null): number {
  if (major === 'Head') return 0.68
  if (major === 'Hand' || major === 'Arm') return 0.62
  if (major === 'Body') return 0.82
  return 1
}

/**
 * The noun/verb movement contrast.
 *
 * In ASL a related noun-verb pair is distinguished by MOVEMENT, not handshape
 * or location: the noun is restrained and smaller, the verb larger and more
 * continuous (SIT/CHAIR, FLY/AIRPLANE). ASL-LEX carries LexicalClass for every
 * entry and the renderer was ignoring it, so a noun and its verb rendered
 * identically - the two signs were literally indistinguishable.
 *
 * This is the contrast coming from the database rather than from an authored
 * table, which is the point: the descriptors already say which it is.
 */
function lexicalSize(lexicalClass: string | null | undefined): number {
  if (lexicalClass === 'Noun') return 0.78
  if (lexicalClass === 'Verb') return 1.12
  return 1
}

/** Rotate a direction about an axis (Rodrigues). */
function rotateAbout(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const k = normalise(axis)
  const c = Math.cos(radians), sn = Math.sin(radians)
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]
  const cross: Vec3 = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ]
  return normalise([
    v[0] * c + cross[0] * sn + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * sn + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * sn + k[2] * dot * (1 - c),
  ])
}

/**
 * ASL-LEX UlnarRotation: the forearm is rotated so the little-finger edge of
 * the hand leads. That is forearm supination/pronation, which is the main
 * degree of freedom in palm orientation - and 215 of the extracted signs carry
 * it. It was being read and then thrown away on a wrist-limit tweak, so those
 * signs presented the same palm as every other sign in their region.
 */
const ULNAR_RADIANS = 1.15

// ---------------------------------------------------------------------------
// Handshape change across a sign
// ---------------------------------------------------------------------------
function blendHands(a: HandPose, b: HandPose, t: number): HandPose {
  return {
    fingers: a.fingers.map((fa, i) => {
      const fb = b.fingers[i] ?? fa
      return {
        curl: [
          fa.curl[0] + (fb.curl[0] - fa.curl[0]) * t,
          fa.curl[1] + (fb.curl[1] - fa.curl[1]) * t,
          fa.curl[2] + (fb.curl[2] - fa.curl[2]) * t,
        ] as const,
        spread: fa.spread + (fb.spread - fa.spread) * t,
      }
    }),
    thumb: {
      abduct: a.thumb.abduct + (b.thumb.abduct - a.thumb.abduct) * t,
      rotate: a.thumb.rotate + (b.thumb.rotate - a.thumb.rotate) * t,
      curl: [
        a.thumb.curl[0] + (b.thumb.curl[0] - a.thumb.curl[0]) * t,
        a.thumb.curl[1] + (b.thumb.curl[1] - a.thumb.curl[1]) * t,
      ] as const,
    },
  }
}

/** FlexionChange=1: the selected fingers open (or close) across the sign. */
function flexionChanged(shape: HandPose): HandPose {
  return {
    fingers: shape.fingers.map((finger) =>
      finger.curl[0] > 0.9
        ? { curl: [0, 0, 0] as const, spread: finger.spread }
        : { curl: [1.26, 1.34, 0.56] as const, spread: finger.spread },
    ),
    thumb: shape.thumb,
  }
}

/** SpreadChange=1: the fingers fan open (or close) across the sign. */
function spreadChanged(shape: HandPose): HandPose {
  const spreading = shape.fingers.every((finger) => Math.abs(finger.spread) < 0.12)
  return {
    fingers: shape.fingers.map((finger, i) => ({
      curl: finger.curl,
      spread: spreading ? (i - 1.5) / 1.5 * 0.28 : finger.spread * 0.15,
    })),
    thumb: shape.thumb,
  }
}

// ---------------------------------------------------------------------------
// One morpheme's pose
// ---------------------------------------------------------------------------
type MorphemeContext = {
  /** 0..1 across this morpheme's own window. */
  travel: number
  /** Movement primitive phase, already multiplied by the repeat count. */
  phase: number
  augment: Augment
  rest: Pose
  /** Sign-level, so it is not on the per-morpheme record. */
  lexicalClass?: string | null
  prior: PhonoPrior | null
}

function poseForMorpheme(m: Morpheme, ctx: MorphemeContext): Pose {
  const { travel, phase, augment, rest } = ctx
  const size = (augment.movement_size ?? defaultSize(m.MajorLocation))
    * lexicalSize(ctx.lexicalClass)

  // --- handshape, refined by the orthogonal descriptor columns -------------
  const descriptors = {
    Flexion: m.Flexion, Spread: m.Spread, ThumbPosition: m.ThumbPosition,
    ThumbContact: m.ThumbContact, SelectedFingers: m.SelectedFingers,
  }
  let dominant = handshapeFor(m.Handshape, descriptors)
  if (m.FlexionChange === '1') {
    dominant = blendHands(dominant, flexionChanged(dominant), easeInOut(phase % 1))
  }
  if (m.SpreadChange === '1') {
    dominant = blendHands(dominant, spreadChanged(dominant), easeInOut(phase % 1))
  }

  // --- sign type ----------------------------------------------------------
  // DominanceViolation and SymmetryViolation are two-handed sign types that the
  // previous `startsWith('Asymmetrical')` test missed entirely, so NAME, LAST,
  // OR and RUN all rendered one-handed.
  const type = m.SignType ?? 'OneHanded'
  const symmetric = type === 'SymmetricalOrAlternating' || type === 'SymmetryViolation'
  const contacted = type.startsWith('Asymmetrical') || type === 'DominanceViolation'
  const twoHanded = symmetric || contacted

  // --- location -----------------------------------------------------------
  const relation = contacted || type === 'DominanceViolation'
    ? relationFor(m.MinorLocation, augment.hand_relation)
    : relationFor(null, augment.hand_relation)
  const onHand = isHandLocated(m.MinorLocation, m.MajorLocation) && relation !== null

  const start = anchor(m.MinorLocation, m.MajorLocation)
  const second = m.SecondMinorLocation && m.SecondMinorLocation !== 'NA'
    ? anchor(m.SecondMinorLocation, m.MajorLocation)
    : null
  const end = second && second !== start ? second : start

  // A sign articulated on the non-dominant hand is positioned RELATIVE to that
  // hand, so the two stay in register whatever the base hand is doing.
  const baseWrist: Vec3 = augment.carried
    ? add(NON_DOMINANT_REST, [0, travel * 0.08, 0])
    : NON_DOMINANT_REST
  const from: Vec3 = onHand ? add(baseWrist, relation!.offset) : start
  const to: Vec3 = onHand
    ? add(from, relation!.travel ?? [0, 0, 0])
    : end
  // ASL-LEX codes a sign as Straight with no second location when the path is
  // LOCAL - a tap, a short push - rather than a relocation. 628 of the 1,285
  // entries are coded that way, and with start == end and a Straight primitive
  // that returns a zero offset, each of them rendered as a hand that travels to
  // one spot and freezes. Half the catalog was a still photograph.
  //
  // The direction is genuinely not in the data, so derive a conservative one
  // rather than inventing a trajectory: a contacting sign taps in toward its
  // location, anything else pushes slightly out and down. The audit reports
  // these so the interpretation stays visible.
  const noRelocation = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 1e-6
  const movementPrior = !onHand && noRelocation && !augment.movement_axis
    ? acceptedDirection(ctx.prior?.movement_dh) : null
  const localPath: Vec3 = noRelocation && m.Movement === 'Straight'
    ? movementPrior ? scale(movementPrior, 0.065)
      : (m.Contact === '1' ? [0, -0.012, -0.05] : [0.015, -0.03, 0.055])
    : [0, 0, 0]
  const base = add(mix(from, to, travel), scale(localPath, travel * size))
  const offsetAt = (at: number): Vec3 => movementPrior && m.Movement === 'BackAndForth'
    ? scale(movementPrior, Math.sin(at * TAU) * MOVEMENT_SCALE.BackAndForth * size)
    : movementOffset(m.Movement, at, size, augment.movement_axis)
  const target = add(base, offsetAt(phase))

  // --- orientation --------------------------------------------------------
  const derived = orientationFor(m.MajorLocation, m.SecondMinorLocation, m)
  // Contact relations and authored start/end orientation outrank a weak prior.
  // One pooled normal cannot describe the separate phases of a compound.
  const priorPalm = !onHand && !augment.orientation && !augment.orientation_end
    ? acceptedDirection(ctx.prior?.orientation_dh) : null
  const start0 = augment.orientation ?? (priorPalm
    ? { palm: priorPalm, point: pointForPalm(priorPalm, derived.point) } : derived)
  const basePalm = onHand && !augment.orientation ? relation!.meetPalm : start0.palm
  // A sign travelling away from the body rotates the palm outward with it. An
  // authored end orientation takes over from that generic outward turn.
  const endPalm: Vec3 = augment.orientation_end
    ? augment.orientation_end.palm
    : [basePalm[0], Math.abs(basePalm[1]) * 0.5, Math.abs(basePalm[2])]
  const rotates = !onHand && !priorPalm && (end !== start || !!augment.orientation_end)
  const orientationTravel = augment.orientation_end ? travel : travel * 0.7
  let palm: Vec3 = rotates ? slerpDirection(basePalm, endPalm, orientationTravel) : basePalm
  const preferredPoint = augment.orientation_end && rotates
    ? slerpDirection(start0.point, augment.orientation_end.point, orientationTravel)
    : start0.point
  // UlnarRotation turns the forearm so the little-finger edge leads, which
  // rotates the palm about the axis the fingers point along.
  if (m.UlnarRotation === '1' && !augment.orientation && !priorPalm) {
    palm = rotateAbout(palm, preferredPoint, ULNAR_RADIANS)
  }
  // A hand has one orthonormal frame. Preserve the semantic palm normal and
  // project the approximate finger direction into its plane, as for priors
  // and authored clips. Otherwise the solver silently changes the palm (47°
  // for FingerTip relations) even when it reaches the requested quaternion.
  palm = normalise(palm)
  const point = pointForPalm(palm, preferredPoint)

  // UlnarRotation=1 turns the forearm so the little-finger edge leads. This
  // column was extracted and never read.
  const elbow = ELBOW_BY_LOCATION[m.MajorLocation ?? 'Neutral'] ?? ELBOW_BY_LOCATION.Neutral

  // --- the non-dominant hand ---------------------------------------------
  let nonDominant: HandPose = rest.leftHand
  // Never null: a null arm made blendPoses switch hard at the midpoint rather
  // than interpolate, which put a snap in every one-handed sign.
  let leftArm: ArmPose = rest.leftArm!

  if (symmetric) {
    nonDominant = handshapeFor(m.NonDominantHandshape ?? m.Handshape, descriptors)
    // An alternating sign runs the two hands half a cycle apart.
    const alt = m.Movement === 'Circular' || type === 'SymmetryViolation'
      ? (phase + 0.5) % 1
      : phase
    leftArm = {
      target: mirror(add(base, offsetAt(alt))),
      palm: normalise(mirror(palm)),
      point: normalise(mirror(point)),
      elbow: normalise(mirror(elbow)),
      contact: m.Contact === '1',
    }
  } else if (contacted) {
    nonDominant = handshapeFor(m.NonDominantHandshape ?? 'open_b')
    const r = relation
    leftArm = {
      target: baseWrist,
      palm: normalise(r ? r.basePalm : [0.1, 0.94, 0.32]),
      point: pointForPalm(normalise(r ? r.basePalm : [0.1, 0.94, 0.32]),
        r ? r.basePoint : [0.75, 0.15, 0.64]),
      elbow: normalise(mirror(ELBOW_BY_LOCATION.Hand)),
      // A flat support palm needs a little more wrist extension than the
      // conservative default allows.
      wristMax: r ? 1.22 : undefined,
      contact: true,
    }
  }

  // --- non-manual markers -------------------------------------------------
  // ASL-LEX codes no non-manual channel. Everything here comes from the
  // `augment` block, which records published ASL grammar rather than a guess:
  // WH-questions furrow the brow, yes/no questions raise it, negation shakes
  // the head. A mild raise at the head keeps a face-located sign from staring.
  const nm = augment.nonmanual ?? {}
  const browFurrow = nm.browFurrow ?? 0
  // The two brow markers drive opposing action units - AU 1+2 raise against AU 4
  // lower - so they cannot both be asserted. A WH-question's furrow outranks the
  // mild ambient raise that keeps a face-located sign from staring.
  const browRaise = nm.browRaise ?? (browFurrow > 0 ? 0 : m.MajorLocation === 'Head' ? 0.12 : 0)

  return {
    rightArm: {
      target,
      palm: normalise(palm),
      point: normalise(point),
      elbow: normalise(elbow),
      contact: m.Contact === '1',
    },
    leftArm,
    rightHand: dominant,
    leftHand: nonDominant,
    head: nm.head ?? [0, twoHanded ? 0 : -0.03, 0],
    torso: 0,
    browRaise,
    browFurrow,
    mouth: nm.mouth ?? 0.06,
    headShake: nm.headShake ?? 0,
  }
}

// ---------------------------------------------------------------------------
// motionFor
// ---------------------------------------------------------------------------
export type MotionOptions = {
  mode?: TimingMode
  /** Explicit clip length, so a backend-planned timeline drives its own timing
   *  instead of the two schedules disagreeing about how long a sign lasts. */
  durationMs?: number
  /** Reference comparison for the audit; normal playback enables priors. */
  usePhonoPriors?: boolean
  /** A contiguous sequence forms the next start pose without returning to rest. */
  skipOnset?: boolean
  skipRelease?: boolean
}

/** Explicit wrist paths and orientation phases for reference-guided candidates. */
function authoredPose(id: string, elapsedSeconds: number, opts: MotionOptions): Pose | null {
  const clip = authoredClipFor(id)
  if (!clip) return null
  const total = opts.durationMs ?? clipLengthMs(id, opts.mode)
  const ms = ((elapsedSeconds * 1000) % total + total) % total
  const onset = Math.min(220, total * 0.2), release = Math.min(200, total * 0.2)
  const phase = clamp((ms - onset) / (total - onset - release), 0, 1)
  const rest = idlePose(elapsedSeconds)
  const framePose = (f: AuthoredFrame): Pose => ({
    ...rest,
    rightArm: { elbow: [0.38, -0.90, -0.10], ...f.right,
      palm: normalise(f.right.palm), point: normalise(f.right.point) },
    leftArm: f.left ? { elbow: [-0.38, -0.90, -0.10], ...f.left,
      palm: normalise(f.left.palm), point: normalise(f.left.point) } : rest.leftArm,
    rightHand: handshapeFor(clip.right_handshape),
    leftHand: clip.left_handshape ? handshapeFor(clip.left_handshape) : rest.leftHand,
    head: [0, 0, 0], browRaise: 0, browFurrow: 0, mouth: 0.06, headShake: 0,
  })
  const upper = clip.keyframes.findIndex(f => f.at > phase)
  const a = clip.keyframes[upper < 0 ? clip.keyframes.length - 1 : Math.max(0, upper - 1)]
  const b = clip.keyframes[upper < 0 ? clip.keyframes.length - 1 : upper]
  const weight = a === b ? 0 : easeInOut((phase - a.at) / (b.at - a.at))
  let pose = blendPoses(framePose(a), framePose(b), weight)
  // Keep the two direction axes orthogonal after interpolation so the wrist
  // solver always receives a usable basis.
  pose = orthogonalAuthoredPose(pose)
  if (ms < onset && !opts.skipOnset) return blendPoses(rest, pose, easeInOut(ms / onset))
  if (ms > total - release && !opts.skipRelease) return blendPoses(pose, rest, easeInOut((ms - total + release) / release))
  return pose
}

function orthogonalAuthoredPose(pose: Pose): Pose {
  const orthogonal = (arm: ArmPose | null): ArmPose | null => arm
    ? { ...arm, point: pointForPalm(arm.palm, arm.point) } : null
  return { ...pose, rightArm: orthogonal(pose.rightArm), leftArm: orthogonal(pose.leftArm) }
}

export function motionFor(
  id: string,
  elapsedSeconds: number,
  opts: MotionOptions = {},
): Pose {
  if (id.startsWith('fs:')) return fingerspellPose(id.slice(3), elapsedSeconds)
  const sequence = authoredSequenceFor(id)
  if (sequence) {
    const mode = opts.mode ?? 'isolated'
    const total = opts.durationMs ?? clipLengthMs(id, mode)
    const factor = total / clipLengthMs(id, mode)
    let start = 0
    const parts = sequence.clips.map(child => {
      const duration = clipLengthMs(child, mode) * factor
      const part = { clip_id: child, start_ms: start, end_ms: start + duration }
      start += duration
      return part
    })
    return sampleSequence(parts, ((elapsedSeconds * 1000) % total + total) % total,
      (child, at, options) => motionFor(child, at, { ...opts, ...options }), blendPoses, mode)
  }
  const authored = authoredPose(id, elapsedSeconds, opts)
  if (authored) return authored
  const sign = SIGNS[id]
  if (!sign) return idlePose(elapsedSeconds)

  // A lexicalised fingerspelling (#BANK, #OK, #TV) is spelled, not posed. The
  // renderer was giving these 21 entries a single static handshape, which is
  // the one thing they are definitely not. The real articulation is a reduced,
  // fluid version of the spelling rather than crisp letters, so this is still
  // an approximation - but a far closer one than holding one letter.
  if (sign.FingerspelledLoanSign === '1') {
    const word = (sign.asl_lex_entry ?? id).replace(/[^A-Za-z0-9]/g, '')
    const nm = augmentFor(id).nonmanual ?? {}
    const pose = fingerspellPose(word, elapsedSeconds)
    return {
      ...pose,
      browRaise: nm.browRaise ?? pose.browRaise,
      browFurrow: nm.browFurrow ?? pose.browFurrow,
      headShake: nm.headShake ?? pose.headShake,
      mouth: nm.mouth ?? pose.mouth,
    }
  }

  const total = opts.durationMs ?? clipLengthMs(id, opts.mode ?? 'isolated')
  const augment = augmentFor(id)
  const rest = idlePose(elapsedSeconds)

  // Fixed-millisecond transitions. Human sign transitions run roughly 150-250
  // ms whatever the sign's length; scaling them with duration made a long clip
  // spend nearly 400 ms drifting back to neutral.
  const onsetMs = Math.min(ONSET_MS, total * 0.25)
  const releaseMs = Math.min(RELEASE_MS, total * 0.25)
  const coreMs = Math.max(1, total - onsetMs - releaseMs)

  const tMs = ((elapsedSeconds * 1000) % total + total) % total

  // Morphemes run in sequence across the core window. A compound such as LEARN
  // (gather from the palm, then to the forehead) is two articulations; a
  // single-block schema rendered only the first and held it.
  const morphemes = morphemesOf(sign)
  const prior = opts.usePhonoPriors !== false && morphemes.length === 1 ? phonoPriorFor(id) : null
  const segmentMs = coreMs / morphemes.length
  const coreT = clamp(tMs - onsetMs, 0, coreMs)
  const index = Math.min(morphemes.length - 1, Math.floor(coreT / segmentMs))
  const localMs = coreT - index * segmentMs

  // Travel occupies the front of the segment and then holds. Extending the hold
  // rather than the stroke is what makes a sign readable without looking slow.
  const strokeMs = Math.min(segmentMs * 0.62, STROKE_MAX_MS)
  const travel = easeInOut(clamp(localMs / strokeMs, 0, 1))

  const repeats = augment.repeat_count
    ?? (morphemes[index].RepeatedMovement === '1' ? 2 : 1)
  const phase = (localMs / segmentMs) * repeats % 1

  const lexicalClass = sign.LexicalClass
  let active = poseForMorpheme(morphemes[index], { travel, phase, augment, rest, lexicalClass, prior })

  // Cross-blend the morpheme boundary so a compound reads as one utterance.
  const MORPHEME_BLEND_MS = 120
  if (index + 1 < morphemes.length && localMs > segmentMs - MORPHEME_BLEND_MS) {
    const next = poseForMorpheme(morphemes[index + 1],
      { travel: 0, phase: 0, augment, rest, lexicalClass, prior })
    const t = (localMs - (segmentMs - MORPHEME_BLEND_MS)) / MORPHEME_BLEND_MS
    active = blendPoses(active, next, easeInOut(t))
  }

  if (tMs < onsetMs && !opts.skipOnset) return blendPoses(rest, active, easeInOut(tMs / onsetMs))
  if (tMs > total - releaseMs && !opts.skipRelease) {
    return blendPoses(active, rest, easeInOut((tMs - (total - releaseMs)) / releaseMs))
  }
  return active
}

/** Linear blend between two poses, used for the release and for sign changes. */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a
  if (t >= 1) return b
  const arm = (x: ArmPose | null, y: ArmPose | null): ArmPose | null => {
    if (!x || !y) return t < 0.5 ? x : y
    const elbow = x.elbow && y.elbow ? slerpDirection(x.elbow, y.elbow, t) : (x.elbow ?? y.elbow)
    const wristMax = x.wristMax === undefined && y.wristMax === undefined
      ? undefined
      : (x.wristMax ?? DEFAULT_WRIST_MAX)
        + ((y.wristMax ?? DEFAULT_WRIST_MAX) - (x.wristMax ?? DEFAULT_WRIST_MAX)) * t
    return {
      target: mix(x.target, y.target, t),
      palm: slerpDirection(x.palm, y.palm, t),
      point: pointForPalm(slerpDirection(x.palm, y.palm, t), slerpDirection(x.point, y.point, t)),
      elbow,
      wristMax,
      // Contact is asserted while either side asserts it, so the renderer does
      // not push the hand off the body midway through a contacting sign.
      contact: t < 0.5 ? x.contact : y.contact,
    }
  }
  const n = (p: number, q: number) => p + (q - p) * t
  return {
    rightArm: arm(a.rightArm, b.rightArm),
    leftArm: arm(a.leftArm, b.leftArm),
    rightHand: blendHands(a.rightHand, b.rightHand, t),
    leftHand: blendHands(a.leftHand, b.leftHand, t),
    head: mix(a.head, b.head, t),
    torso: n(a.torso, b.torso),
    browRaise: n(a.browRaise, b.browRaise),
    browFurrow: n(a.browFurrow, b.browFurrow),
    mouth: n(a.mouth, b.mouth),
    headShake: n(a.headShake, b.headShake),
  }
}

// ---------------------------------------------------------------------------
// Fingerspelling.
//
// This is the fallback for every unsupported word, so it is the most-rendered
// path in the application. The previous alphabet resolved 26 letters onto 13
// poses - D, G, L, Q and Z were all the `1` handshape - which made most of the
// alphabet unreadable. Each letter now carries its own handshape plus the palm
// and finger direction that distinguishes it from its neighbours.
// ---------------------------------------------------------------------------
function fingerspellPose(word: string, elapsedSeconds: number): Pose {
  const letters = word.toUpperCase().replace(/[^A-Z0-9]/g, '').split('')
  if (!letters.length) return idlePose(elapsedSeconds)
  const letterSeconds = 0.36
  const index = Math.min(letters.length - 1, Math.floor(elapsedSeconds / letterSeconds))
  const letter = letters[index]
  const phase = (elapsedSeconds / letterSeconds) % 1
  const form = FINGERSPELL[letter] ?? FINGERSPELL['1']

  // J hooks downward and Z draws a zigzag; every other letter is held, with a
  // small settle so consecutive letters do not look like hard cuts.
  const trace: Vec3 = form.trace === 'hook'
    ? [Math.sin(phase * Math.PI) * 0.10, -phase * 0.14, 0]
    : form.trace === 'zigzag'
      ? [Math.sin(phase * Math.PI * 3) * 0.11, -phase * 0.07, 0]
      : [0, Math.sin(phase * Math.PI) * 0.016, 0]

  // Base on the live neutral pose rather than a static rest constant, so the
  // non-dominant arm keeps its natural hang and the body keeps breathing.
  return {
    ...idlePose(elapsedSeconds),
    rightArm: {
      target: add(ANCHORS.Neutral, trace),
      palm: normalise(form.palm),
      point: normalise(form.point),
      elbow: normalise(ELBOW_BY_LOCATION.Neutral),
    },
    rightHand: handshapeFor(form.shape),
    head: [0, -0.04, 0],
    mouth: 0.04,
  }
}

// ---------------------------------------------------------------------------
// Neutral stance.
//
// A person at rest carries a bend in the elbow, keeps the hands clear of the
// body, and is never symmetrical.
// ---------------------------------------------------------------------------
/**
 * The previous rest held the hands at 0.80 of arm reach, which is about 74
 * degrees of elbow flexion - not a person standing at ease but a person holding
 * their hands up in front of their belly, waiting. A relaxed standing arm runs
 * 10-20 degrees of flexion; these sit at 27 and 22, so the arms hang but the
 * elbows are not locked.
 *
 * Dropping the hands is safe precisely because the earlier note about the arms
 * reading as a shop dummy was not about extension. What makes a neutral stance
 * look alive is asymmetry, the finger cascade, the palm turned in toward the
 * thigh, and the breathing and weight shift below - none of which is lost by
 * letting the arms actually hang. The two sides deliberately differ.
 */
// Held a little short of the IK's own limit: the breathing offsets below push
// the target further out, and at 0.99 of reach the solver clamps and the arm
// snaps straight for a frame.
//
// Carried forward of the hips and slightly outboard so the fingers clear the
// trousers. The elliptical torso-clearance field in Avatar only bulges around
// the chest band, so it contributes nothing at thigh height - at rest the hands
// are below it and the wrists have to be placed clear on their own. A relaxed
// humerus hangs slightly anterior anyway, so forward is also the truer pose.
const REST_RIGHT: Vec3 = [0.355, -0.811, 0.345]
const REST_LEFT: Vec3 = [-0.335, -0.823, 0.358]
/**
 * Palms face back and in, as they do at rest. Weighted toward the rear rather
 * than straight across the body: the fingers curl toward whatever the palm
 * faces, so a palm turned flat against the thigh curls the fingertips into it.
 */
const REST_PALM_RIGHT: Vec3 = [-0.70, 0.06, -0.71]
const REST_PALM_LEFT: Vec3 = [0.68, 0.05, -0.73]
const REST_POINT_RIGHT: Vec3 = [0.06, -0.975, 0.21]
const REST_POINT_LEFT: Vec3 = [-0.05, -0.978, 0.20]

/**
 * Hands at rest curl slightly, each finger a little more than the last. The
 * cascade is the tell: a hand with every finger at the same angle reads as a
 * glove. Deepened alongside the lower arms, because a hanging hand carries more
 * flexion than one held up.
 */
const IDLE_HAND: HandPose = {
  fingers: [
    { curl: [0.26, 0.42, 0.24], spread: -0.006 },
    { curl: [0.30, 0.48, 0.27], spread: 0.0 },
    { curl: [0.34, 0.53, 0.29], spread: 0.006 },
    { curl: [0.38, 0.57, 0.31], spread: 0.014 },
  ],
  thumb: { abduct: 0.26, rotate: 0.30, curl: [0.24, 0.20] },
}

export function idlePose(t: number): Pose {
  // Breathing, plus a much slower weight shift. The two are deliberately at
  // unrelated frequencies so the loop never becomes obvious.
  const breath = Math.sin(t * 1.35)
  const shift = Math.sin(t * 0.21)
  const sway = Math.sin(t * 0.17 + 1.1)

  const right: Vec3 = [
    REST_RIGHT[0] + shift * 0.012,
    REST_RIGHT[1] + breath * 0.008,
    REST_RIGHT[2] + breath * 0.012,
  ]
  const left: Vec3 = [
    REST_LEFT[0] + shift * 0.010,
    REST_LEFT[1] + breath * 0.007 + shift * 0.006,
    REST_LEFT[2] + breath * 0.010,
  ]

  return {
    rightArm: {
      target: right,
      palm: normalise(REST_PALM_RIGHT),
      point: pointForPalm(normalise(REST_PALM_RIGHT), REST_POINT_RIGHT),
      elbow: normalise([0.29, -0.945, -0.15]),
    },
    leftArm: {
      target: left,
      palm: normalise(REST_PALM_LEFT),
      point: pointForPalm(normalise(REST_PALM_LEFT), REST_POINT_LEFT),
      elbow: normalise([-0.27, -0.95, -0.16]),
    },
    rightHand: IDLE_HAND,
    leftHand: IDLE_HAND,
    head: [Math.sin(t * 0.31) * 0.02, sway * 0.045, shift * 0.012],
    torso: sway * 0.018,
    browRaise: 0,
    browFurrow: 0,
    mouth: 0,
    headShake: 0,
  }
}

/** Breathing amount for the spine, exported so the rig can drive the chest. */
export const breathAt = (t: number) => Math.sin(t * 1.35)

export { RELAXED, scale }

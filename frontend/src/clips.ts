/**
 * Pose composition for the illustrative avatar.
 *
 * Motion is composed from ASL-LEX 2.0 phonological descriptors
 * (data/asl_lex_params.json, CC BY-NC 4.0 - see data/LICENSE and NOTICE)
 * rather than hand-invented joint angles: a handshape library, a set of
 * location anchors and a set of movement primitives are combined per sign.
 *
 * THIS IS STILL NOT VALIDATED ASL. ASL-LEX describes signs; it is not an
 * animation specification. Turning "Curved movement at Head/Mouth" into a
 * trajectory is interpretation, and the result must be reviewed by a
 * qualified Deaf signer before it is called a translation.
 */
import params from '../../data/asl_lex_params.json'

export type ClipId = string

/** MCP / PIP / DIP flexion in radians, plus abduction from the neighbouring finger. */
export type FingerPose = { curl: readonly [number, number, number]; spread: number }
/** Thumb has its own abduction, opposition rotation and two flexion joints. */
export type ThumbPose = { abduct: number; rotate: number; curl: readonly [number, number] }
export type HandPose = { fingers: readonly FingerPose[]; thumb: ThumbPose }
export type Vec3 = readonly [number, number, number]
/**
 * `palm` is the direction the palm faces; `point` is the direction the
 * fingers point. Palm orientation is one of the five classical ASL
 * parameters but is NOT among the ASL-LEX columns extracted here, so these
 * values are an interpretive layer added on top of the licensed data.
 */
export type ArmPose = { target: Vec3; palm: Vec3; point: Vec3 }
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
}

// ---------------------------------------------------------------------------
// Finger flexion presets, keyed to the ASL-LEX `Flexion` vocabulary.
// ---------------------------------------------------------------------------
const EXTENDED = [0, 0, 0] as const          // FullyOpen
const FLAT = [1.32, 0.05, 0.02] as const     // Flat  - bent at the knuckle only
const BENT = [0.42, 0.78, 0.36] as const     // Bent  - curved through the joints
const CURVED = [0.72, 0.95, 0.44] as const   // Curved
const CLOSED = [1.55, 1.64, 0.62] as const   // FullyClosed
const STACKED = [1.48, 1.55, 0.5] as const   // folded under the thumb

const THUMB = {
  open:     { abduct: 0.62, rotate: 0.18, curl: [0.08, 0.06] as const },
  closed:   { abduct: 0.14, rotate: 0.78, curl: [0.58, 0.52] as const },
  opposed:  { abduct: 0.34, rotate: 1.02, curl: [0.62, 0.40] as const },
  extended: { abduct: 0.98, rotate: 0.06, curl: [0.0, 0.0] as const },
  tucked:   { abduct: 0.1, rotate: 0.9, curl: [0.75, 0.6] as const },
} satisfies Record<string, ThumbPose>

const f = (curl: readonly [number, number, number], spread = 0): FingerPose => ({ curl, spread })
const hand = (fingers: FingerPose[], thumb: ThumbPose): HandPose => ({ fingers, thumb })

/**
 * Handshape library. Keys are ASL-LEX `Handshape` values; fingers are ordered
 * index, middle, ring, pinky to match the rig.
 */
export const HANDSHAPES: Record<string, HandPose> = {
  // flat / open family
  open_b:       hand([f(EXTENDED), f(EXTENDED), f(EXTENDED), f(EXTENDED)], THUMB.open),
  closed_b:     hand([f(EXTENDED), f(EXTENDED), f(EXTENDED), f(EXTENDED)], THUMB.closed),
  flat_b:       hand([f(EXTENDED), f(EXTENDED), f(EXTENDED), f(EXTENDED)], THUMB.closed),
  b:            hand([f(EXTENDED), f(EXTENDED), f(EXTENDED), f(EXTENDED)], THUMB.closed),
  flatspread_5: hand([f(FLAT, -0.26), f(FLAT, -0.09), f(FLAT, 0.09), f(FLAT, 0.26)], THUMB.extended),
  '5':          hand([f(EXTENDED, -0.3), f(EXTENDED, -0.1), f(EXTENDED, 0.1), f(EXTENDED, 0.3)], THUMB.extended),
  curved_5:     hand([f(CURVED, -0.24), f(CURVED, -0.08), f(CURVED, 0.08), f(CURVED, 0.24)], THUMB.extended),
  // closed family
  a:            hand([f(CLOSED), f(CLOSED), f(CLOSED), f(CLOSED)], THUMB.open),
  s:            hand([f(CLOSED), f(CLOSED), f(CLOSED), f(CLOSED)], THUMB.closed),
  fist:         hand([f(CLOSED), f(CLOSED), f(CLOSED), f(CLOSED)], THUMB.closed),
  // selected-finger family
  '1':          hand([f(EXTENDED), f(STACKED), f(STACKED), f(STACKED)], THUMB.tucked),
  flat_h:       hand([f(FLAT, -0.03), f(FLAT, 0.03), f(STACKED), f(STACKED)], THUMB.tucked),
  h:            hand([f(EXTENDED, -0.03), f(EXTENDED, 0.03), f(STACKED), f(STACKED)], THUMB.tucked),
  v:            hand([f(EXTENDED, -0.2), f(EXTENDED, 0.2), f(STACKED), f(STACKED)], THUMB.tucked),
  y:            hand([f(STACKED), f(STACKED), f(STACKED), f(EXTENDED, 0.32)], THUMB.extended),
  // contact family - a fingertip meets the thumb
  baby_o:       hand([f(BENT), f(STACKED), f(STACKED), f(STACKED)], THUMB.opposed),
  open_8:       hand([f(EXTENDED, -0.12), f(BENT), f(EXTENDED, 0.12), f(EXTENDED, 0.24)], THUMB.opposed),
  o:            hand([f(CURVED), f(CURVED), f(CURVED), f(CURVED)], THUMB.opposed),
}

const RELAXED: HandPose = hand(
  [f([0.24, 0.34, 0.2], -0.06), f([0.26, 0.38, 0.22], -0.02), f([0.3, 0.42, 0.24], 0.02), f([0.34, 0.46, 0.26], 0.08)],
  { abduct: 0.36, rotate: 0.3, curl: [0.24, 0.2] },
)

export function handshapeFor(name: string | null | undefined): HandPose {
  if (!name) return RELAXED
  return HANDSHAPES[name.toLowerCase()] ?? RELAXED
}

// ---------------------------------------------------------------------------
// Location anchors, in the avatar's body space (same frame as the shoulders).
// Keyed to ASL-LEX `MajorLocation` / `MinorLocation`.
// ---------------------------------------------------------------------------
/**
 * Location anchors in a NORMALISED BODY FRAME, so they fit any humanoid rig:
 *   origin  the midpoint between the shoulders
 *   unit    arm reach (shoulder to wrist)
 *   +x      the dominant-hand side, +y up, +z forward
 *
 * Values are human proportions measured from the rig, not the cartoon
 * proportions of the earlier primitive avatar.
 * Keyed to ASL-LEX `MajorLocation` / `MinorLocation`.
 */
const ANCHORS: Record<string, Vec3> = {
  Neutral: [0.28, -0.32, 0.50],
  Head: [0.20, 0.29, 0.12],
  Forehead: [0.18, 0.39, 0.13],
  Eye: [0.19, 0.32, 0.13],
  Nose: [0.10, 0.26, 0.16],
  Mouth: [0.11, 0.21, 0.15],
  Chin: [0.11, 0.14, 0.15],
  Cheek: [0.28, 0.25, 0.09],
  HeadAway: [0.52, 0.30, 0.28],
  UnderChin: [0.12, 0.10, 0.17],
  Body: [0.24, -0.48, 0.40],
  Neck: [0.15, 0.04, 0.15],
  Chest: [0.24, -0.22, 0.42],
  Hand: [-0.02, -0.32, 0.52],
  Palm: [-0.02, -0.32, 0.52],
  Arm: [-0.30, -0.30, 0.38],
  Other: [0.28, -0.32, 0.50],
}
const NON_DOMINANT_REST: Vec3 = [-0.24, -0.34, 0.50]

function anchor(minor?: string | null, major?: string | null): Vec3 {
  return ANCHORS[minor ?? ''] ?? ANCHORS[major ?? ''] ?? ANCHORS.Neutral
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mix = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// ---------------------------------------------------------------------------
// Movement primitives. Each returns an offset applied to the path position.
// Keyed to the eight ASL-LEX `Movement` values.
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2
function movementOffset(kind: string | null | undefined, phase: number): Vec3 {
  const p = phase
  switch (kind) {
    case 'Straight':     return [0, 0, 0]
    case 'Curved':       return [0, Math.sin(p * Math.PI) * 0.14, Math.sin(p * Math.PI) * 0.09]
    case 'Circular':     return [Math.cos(p * TAU) * 0.12, Math.sin(p * TAU) * 0.12, 0]
    case 'BackAndForth': return [0, 0, Math.sin(p * TAU) * 0.13]
    case 'Z-shaped':     return [Math.sin(p * TAU * 1.5) * 0.14, Math.cos(p * TAU) * 0.06 - 0.06, 0]
    case 'X-shaped':     return [Math.sin(p * TAU) * 0.13, Math.sin(p * TAU * 2) * 0.1, 0]
    case 'None':         return [0, Math.sin(p * TAU) * 0.014, 0]
    default:             return [0, 0, 0]
  }
}

// ---------------------------------------------------------------------------
type SignParams = {
  asl_lex_entry: string
  fidelity: string
  mapping_note: string | null
  duration_ms: number | null
  Handshape: string | null
  SelectedFingers: string | null
  Flexion: string | null
  FlexionChange: string | null
  Spread: string | null
  ThumbPosition: string | null
  SignType: string | null
  Movement: string | null
  RepeatedMovement: string | null
  MajorLocation: string | null
  MinorLocation: string | null
  SecondMinorLocation: string | null
  Contact: string | null
  NonDominantHandshape: string | null
  UlnarRotation: string | null
}
const SIGNS = (params as { signs: Record<string, SignParams> }).signs

/** True when the sign's parameters came from ASL-LEX rather than a fallback. */
export function isParameterised(id: string): boolean {
  return id in SIGNS
}
export function signParams(id: string): SignParams | null {
  return SIGNS[id] ?? null
}

/**
 * Citation-form durations in ASL-LEX are short (334-1134 ms) because they are
 * isolated elicitations. Stretch them for on-screen legibility, with a floor
 * so no clip flashes past.
 */
export const CLIP_LENGTH_MS: Record<string, number> = Object.fromEntries(
  Object.entries(SIGNS).map(([id, s]) => [id, Math.max(1250, Math.round((s.duration_ms ?? 600) * 2.1))]),
)
CLIP_LENGTH_MS.idle = 2600
CLIP_LENGTH_MS.artificial_intelligence = 2350

/** Blend two hand poses, used for ASL-LEX `FlexionChange`. */
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

/** Open the selected fingers, for FlexionChange on a closed handshape. */
function openedVariant(shape: HandPose): HandPose {
  return {
    fingers: shape.fingers.map((finger) =>
      finger.curl[0] > 0.9 ? finger : f(EXTENDED, finger.spread),
    ),
    thumb: shape.thumb,
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

// ---------------------------------------------------------------------------
// Hand orientation.
//
// INTERPRETIVE LAYER - not derived from the ASL-LEX extract. Palm orientation
// is a real ASL parameter but is not among the columns in
// data/asl_lex_params.json, so these are authored approximations and must be
// reviewed by a qualified signer along with everything else.
// ---------------------------------------------------------------------------
type Orientation = { palm: Vec3; point: Vec3 }

const ORIENTATION: Record<string, Orientation> = {
  hello:        { palm: [0.35, 0, 0.94], point: [0.12, 0.99, 0] },      // salute, palm outward
  good_morning: { palm: [0, 0.75, 0.66], point: [0.2, 0.55, 0.8] },
  thank_you:    { palm: [0, 0.6, -0.8], point: [0, 0.95, 0.3] },        // starts facing the chin
  understand:   { palm: [0, 0.2, -0.98], point: [0, 1, 0] },
  yes:          { palm: [0, -0.1, 0.99], point: [0, 1, 0] },            // knuckles up, nodding fist
  no:           { palm: [0, 0.1, 0.99], point: [0.1, 0.95, 0.3] },
  question:     { palm: [0, 0, 1], point: [0.1, 0.98, 0.15] },
  today:        { palm: [0, 1, 0], point: [0.1, 0.25, 0.96] },          // Y-hands, palms up
  computer:     { palm: [-0.9, 0.1, 0.42], point: [0.15, 0.8, 0.58] },
  help:         { palm: [-0.95, 0.05, 0.3], point: [0, 0.98, 0.2] },    // A-hand on the flat palm
  learn:        { palm: [0, -0.9, 0.44], point: [0.1, 0.1, 0.99] },     // gathers off the palm
}

const BY_LOCATION: Record<string, Orientation> = {
  Head: { palm: [0, 0.2, -0.96], point: [0, 1, 0] },
  Hand: { palm: [0, -0.9, 0.44], point: [0.1, 0.2, 0.97] },
  Body: { palm: [0, 0, -1], point: [0.1, 0.9, 0.4] },
  Arm:  { palm: [0, -0.8, 0.6], point: [-0.9, 0.2, 0.4] },
  Neutral: { palm: [0, 0, 1], point: [0.1, 0.95, 0.3] },
}

function orientationFor(id: string, sign: SignParams): Orientation {
  return ORIENTATION[id] ?? BY_LOCATION[sign.MajorLocation ?? 'Neutral'] ?? BY_LOCATION.Neutral
}

export function motionFor(id: string, elapsedSeconds: number): Pose {
  const sign = SIGNS[id]
  if (!sign) return idlePose(elapsedSeconds)

  // A sign is not a loop: it travels, holds briefly, then releases toward
  // neutral before repeating. Cutting straight back to the start is what makes
  // playback read as a slideshow.
  const durationS = (CLIP_LENGTH_MS[id] ?? 1600) / 1000
  const SIGN = 0.72, HOLD = 0.84, RELEASE = 1, ONSET = 0.1
  const cycle = (elapsedSeconds / (durationS / SIGN)) % 1
  const raw = Math.min(1, cycle / SIGN)
  const release = cycle <= HOLD ? 0 : easeInOut((cycle - HOLD) / (RELEASE - HOLD))
  // Ramp into the sign as well as out of it. Releasing to neutral and then
  // snapping back to the sign's start pose put a jump at every loop point.
  const onset = easeInOut(Math.min(1, cycle / ONSET))

  // The movement repeats; the location path does not. Driving both from one
  // sawtooth made the hand jump back at each repeat.
  const repeats = sign.RepeatedMovement === '1' ? 2 : 1
  const phase = (elapsedSeconds / (durationS / repeats)) % 1

  // Path: MinorLocation -> SecondMinorLocation when the sign relocates.
  const start = anchor(sign.MinorLocation, sign.MajorLocation)
  const second = sign.SecondMinorLocation && sign.SecondMinorLocation !== 'NA'
    ? anchor(sign.SecondMinorLocation, sign.MajorLocation)
    : null
  const end = second && second !== start ? second : start

  const travel = easeInOut(Math.min(1, raw * 1.1))
  const atBaseHand = sign.MajorLocation === 'Hand'
  // A sign located at the non-dominant hand rests on top of it; anchoring it
  // absolutely makes the two hands interpenetrate.
  const contactStart: Vec3 = atBaseHand ? add(NON_DOMINANT_REST, [0.14, 0.15, 0.03]) : start
  const contactEnd: Vec3 = atBaseHand ? add(contactStart, [0.06, 0.13, 0.04]) : end
  const base = mix(contactStart, contactEnd, travel)
  const target = add(base, movementOffset(sign.Movement, phase))

  // Handshape, morphing across the sign when FlexionChange is set.
  let dominant = handshapeFor(sign.Handshape)
  if (sign.FlexionChange === '1') {
    dominant = blendHands(dominant, openedVariant(dominant), easeInOut(phase))
  }

  const twoHanded = sign.SignType === 'SymmetricalOrAlternating'
  const asymmetric = sign.SignType?.startsWith('Asymmetrical') ?? false
  const orient = orientationFor(id, sign)

  // A sign that travels away from the body rotates the palm outward with it.
  const palm: Vec3 = end !== start
    ? mix(orient.palm, [orient.palm[0], Math.abs(orient.palm[1]) * 0.5, Math.abs(orient.palm[2])], travel * 0.7)
    : orient.palm

  const resting = idlePose(elapsedSeconds)
  let nonDominant: HandPose = resting.leftHand
  // Never null: a null arm made blendPoses switch hard at the midpoint rather
  // than interpolate, which put a snap in every one-handed sign.
  let leftArm: ArmPose = resting.leftArm!
  if (twoHanded) {
    nonDominant = handshapeFor(sign.NonDominantHandshape ?? sign.Handshape)
    const alt = sign.Movement === 'Circular' ? (phase + 0.5) % 1 : phase
    leftArm = {
      target: add(mirror(mix(start, end, travel)), mirror(movementOffset(sign.Movement, alt))),
      palm: mirror(palm),
      point: mirror(orient.point),
    }
  } else if (asymmetric) {
    // Base hand holds still and presents its palm for the dominant hand.
    nonDominant = handshapeFor(sign.NonDominantHandshape ?? 'flat_b')
    leftArm = { target: NON_DOMINANT_REST, palm: [0.1, 0.94, 0.32], point: [0.75, 0.15, 0.64] }
  }

  // Non-manual markers. ASL-LEX does not encode these; the brow raise on
  // question forms is a deliberate, clearly-labelled approximation.
  // ASK is elicited as a citation form, not a marked question; the raise is an
  // authored approximation of the yes/no question marker. Furrow (WH-questions)
  // has no catalog entry yet.
  const browRaise = id === 'question' ? 1 : sign.MajorLocation === 'Head' ? 0.12 : 0
  const mouth = id === 'hello' || id === 'good_morning' ? 0.3 : 0.06

  const active: Pose = {
    rightArm: { target, palm, point: orient.point },
    leftArm,
    rightHand: dominant,
    leftHand: nonDominant,
    head: [0, twoHanded ? 0 : -0.03, 0],
    torso: 0,
    browRaise,
    browFurrow: 0,
    mouth,
  }
  if (release > 0) return blendPoses(active, resting, release)
  if (onset < 1) return blendPoses(resting, active, onset)
  return active
}

/** Linear blend between two poses, used for the release and for sign changes. */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a
  if (t >= 1) return b
  const arm = (x: ArmPose | null, y: ArmPose | null): ArmPose | null => {
    if (!x || !y) return t < 0.5 ? x : y
    return { target: mix(x.target, y.target, t), palm: mix(x.palm, y.palm, t), point: mix(x.point, y.point, t) }
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
  }
}

const mirror = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]

/**
 * Neutral stance.
 *
 * The previous version left the arms 95% extended and pinned to the thighs,
 * which is what read as a shop dummy. A person at rest carries a bend in the
 * elbow, keeps the hands clear of the body, and is never symmetrical.
 */
const REST_RIGHT: Vec3 = [0.375, -0.80, 0.17]
const REST_LEFT: Vec3 = [-0.35, -0.825, 0.14]
const REST_PALM_RIGHT: Vec3 = [-0.42, 0.0, -0.91]
const REST_PALM_LEFT: Vec3 = [0.42, 0.0, -0.91]
const REST_POINT_RIGHT: Vec3 = [0.04, -0.98, 0.17]
const REST_POINT_LEFT: Vec3 = [-0.03, -0.985, 0.14]

/** Hands at rest curl slightly, each finger a little more than the last. */
const IDLE_HAND: HandPose = hand(
  [f([0.22, 0.32, 0.18], -0.005), f([0.26, 0.36, 0.20], 0.0),
   f([0.30, 0.40, 0.22], 0.005), f([0.35, 0.44, 0.24], 0.012)],
  { abduct: 0.22, rotate: 0.36, curl: [0.30, 0.26] },
)

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
    rightArm: { target: right, palm: REST_PALM_RIGHT, point: REST_POINT_RIGHT },
    leftArm: { target: left, palm: REST_PALM_LEFT, point: REST_POINT_LEFT },
    rightHand: IDLE_HAND,
    leftHand: IDLE_HAND,
    head: [Math.sin(t * 0.31) * 0.02, sway * 0.045, shift * 0.012],
    torso: sway * 0.018,
    browRaise: 0,
    browFurrow: 0,
    mouth: 0,
  }
}

/** Breathing amount for the spine, exported so the rig can drive the chest. */
export const breathAt = (t: number) => Math.sin(t * 1.35)

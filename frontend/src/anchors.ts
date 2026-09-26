/**
 * Location anchors and two-handed relations.
 *
 * ASL-LEX codes 37 distinct MinorLocation values and 38 SecondMinorLocation
 * values. The previous table carried 18 names, several of them app-invented
 * (`Chest`, `Cheek`) rather than ASL-LEX vocabulary, so most real location
 * codes fell through to `Neutral` - a sign coded at `FingerRadial` or
 * `Clavicle` or `TorsoTop` was rendered in neutral space in front of the body.
 *
 * Every value the database actually uses now has an anchor, and the
 * non-dominant hand surfaces additionally carry a RELATION: which face of the
 * base hand the dominant hand meets, and how the base hand must be turned to
 * present it. That replaces the per-sign `id === 'help'` offsets that were
 * hardcoded in ./clips.
 *
 * FRAME: origin at the midpoint between the shoulders, unit of one arm reach
 * (shoulder to wrist), +x toward the dominant hand, +y up, +z forward. This is
 * rig-independent, so the same numbers fit any humanoid skeleton.
 */
export type Vec3 = readonly [number, number, number]

/**
 * Where the non-dominant hand rests when it acts as a base. Everything in
 * HAND_SURFACE is expressed relative to this point.
 */
export const NON_DOMINANT_REST: Vec3 = [-0.22, -0.27, 0.55]

export const ANCHORS: Record<string, Vec3> = {
  // --- neutral signing space ---------------------------------------------
  Neutral: [0.27, -0.22, 0.53],
  Other: [0.27, -0.22, 0.53],
  OtherAway: [0.31, -0.19, 0.59],
  // ASL-LEX writes a bare "Away" when the second location is off the body
  // without naming which region it left.
  Away: [0.30, -0.20, 0.60],

  // --- head --------------------------------------------------------------
  // The head is about 0.12 reach units wide from the midline (head half-width
  // .04H over a reach of .332H), and the wrist reaches the shoulder edge at
  // about 0.35. The upper-face anchors used to sit at 0.16-0.23, i.e. up to
  // 1.9x the head half-width, so a sign coded at Forehead or Eye or CheekNose
  // landed BESIDE the head rather than on it, with the elbow flared out to
  // reach. These are pulled back inside the head, and raised slightly to match
  // where the brow and eyes actually are.
  Head: [0.12, 0.30, 0.29],
  HeadTop: [0.09, 0.50, 0.22],
  Forehead: [0.12, 0.40, 0.30],
  Eye: [0.11, 0.34, 0.30],
  CheekNose: [0.13, 0.25, 0.30],
  UpperLip: [0.08, 0.20, 0.32],
  Mouth: [0.08, 0.18, 0.31],
  Chin: [0.08, 0.13, 0.31],
  UnderChin: [0.08, 0.08, 0.30],
  // Off the head, out in space beside it. Kept inboard of the shoulder: an
  // x beyond ~0.40 pulls the wrist outside the shoulder and locks the arm.
  HeadAway: [0.38, 0.29, 0.42],

  // --- neck, torso, hips -------------------------------------------------
  Neck: [0.09, 0.03, 0.30],
  Clavicle: [0.16, -0.06, 0.34],
  Shoulder: [0.34, -0.02, 0.28],
  Body: [0.22, -0.36, 0.48],
  TorsoTop: [0.20, -0.16, 0.44],
  TorsoMid: [0.20, -0.30, 0.46],
  TorsoBottom: [0.19, -0.44, 0.45],
  Waist: [0.20, -0.52, 0.44],
  Hips: [0.22, -0.60, 0.42],
  BodyAway: [0.30, -0.28, 0.58],

  // --- the non-dominant hand as a place ----------------------------------
  // Absolute fallbacks. A sign coded at one of these is normally positioned
  // through HAND_SURFACE instead, which keeps the two hands in register.
  Hand: [-0.02, -0.27, 0.55],
  Palm: [-0.02, -0.27, 0.55],
  PalmBack: [-0.02, -0.27, 0.55],
  Heel: [-0.08, -0.31, 0.54],
  FingerFront: [0.05, -0.22, 0.58],
  FingerBack: [0.05, -0.24, 0.53],
  FingerRadial: [0.03, -0.23, 0.57],
  FingerUlnar: [-0.07, -0.26, 0.57],
  FingerTip: [0.09, -0.19, 0.58],
  WristBack: [-0.12, -0.33, 0.52],
  WristFront: [-0.12, -0.33, 0.55],
  HandAway: [0.17, -0.24, 0.62],

  // --- the non-dominant arm as a place -----------------------------------
  Arm: [-0.25, -0.25, 0.46],
  UpperArm: [-0.27, -0.17, 0.40],
  ForearmBack: [-0.22, -0.28, 0.43],
  ForearmFront: [-0.22, -0.28, 0.49],
  ForearmUlnar: [-0.27, -0.28, 0.45],
  ForearmRadial: [-0.17, -0.26, 0.48],
  ElbowBack: [-0.33, -0.30, 0.36],
  ElbowFront: [-0.31, -0.30, 0.44],
  ArmAway: [-0.13, -0.21, 0.58],
}

/**
 * App-catalog names that predate the ASL-LEX vocabulary. Kept so the six
 * app-authored entries in data/asl_custom_motions.json keep resolving.
 */
const LOCATION_ALIASES: Record<string, string> = {
  Chest: 'TorsoTop',
  Cheek: 'CheekNose',
  Nose: 'CheekNose',
}

export function anchor(minor?: string | null, major?: string | null): Vec3 {
  const key = minor && minor !== 'NA' ? (LOCATION_ALIASES[minor] ?? minor) : ''
  const fallback = major ? (LOCATION_ALIASES[major] ?? major) : ''
  return ANCHORS[key] ?? ANCHORS[fallback] ?? ANCHORS.Neutral
}

/** True when the location names a surface of the non-dominant hand or arm. */
export function isHandLocated(minor?: string | null, major?: string | null): boolean {
  if (major === 'Hand' || major === 'Arm') return true
  return !!minor && minor in HAND_SURFACE
}

// ---------------------------------------------------------------------------
// Two-handed relations.
//
// A sign coded MajorLocation=Hand is articulated ON the non-dominant hand. The
// contact surface is in the licensed data - MinorLocation is Palm, PalmBack,
// Heel, FingerFront, FingerBack, FingerRadial, FingerUlnar, FingerTip,
// WristBack or WristFront - so the relation does not have to be authored per
// sign. Each entry records where the dominant WRIST sits relative to the base
// wrist, and how the base hand is turned to present that surface.
// ---------------------------------------------------------------------------
export type HandRelation = {
  /** Dominant wrist offset from the base wrist, in the normalised frame. */
  offset: Vec3
  /** Direction the BASE hand's palm faces to present this surface. */
  basePalm: Vec3
  /** Direction the BASE hand's fingers point. */
  basePoint: Vec3
  /** Direction the DOMINANT palm faces to meet the surface. */
  meetPalm: Vec3
  /** Travel applied across the stroke when the sign moves along the surface. */
  travel?: Vec3
}

const PALM_UP: Vec3 = [0.06, 0.97, 0.22]
const PALM_DOWN: Vec3 = [0.04, -0.96, 0.28]
const POINT_ACROSS: Vec3 = [0.96, 0.06, 0.26]

export const HAND_SURFACE: Record<string, HandRelation> = {
  // Base palm up, dominant hand lands on it from above.
  Palm: {
    offset: [0.05, 0.05, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.05, 0.02],
  },
  // Base palm down, dominant hand works on the back of it.
  PalmBack: {
    offset: [0.05, 0.06, 0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.03, 0.01],
  },
  // The heel of the base palm, nearer the wrist.
  Heel: {
    offset: [-0.04, 0.05, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.05, 0.02, 0.01],
  },
  // The front (palm side) of the base fingers.
  FingerFront: {
    offset: [0.12, 0.05, 0.03], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.03, 0.01],
  },
  FingerBack: {
    offset: [0.12, 0.05, -0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.02, 0.01],
  },
  // The thumb-side edge of the base fingers. NAME crosses the H-hands here,
  // which is why an offset near the wrists produced the crossed-hand artifact.
  FingerRadial: {
    offset: [0.10, 0.09, 0.02], basePalm: [0.10, -0.32, 0.94], basePoint: POINT_ACROSS,
    meetPalm: [0.06, -0.94, 0.33], travel: [0, 0.02, 0],
  },
  // The little-finger-side edge.
  FingerUlnar: {
    offset: [0.02, 0.11, 0.02], basePalm: [0.12, 0.34, 0.93], basePoint: POINT_ACROSS,
    meetPalm: [0.04, -0.92, 0.39], travel: [0, 0.02, 0],
  },
  // Fingertips meeting fingertips.
  FingerTip: {
    offset: [0.18, 0.07, 0.02], basePalm: [0.28, 0.42, 0.86], basePoint: [0.86, 0.46, 0.22],
    meetPalm: [-0.30, -0.40, 0.87], travel: [0.02, 0.02, 0],
  },
  WristBack: {
    offset: [-0.10, 0.04, 0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.02, 0],
  },
  WristFront: {
    offset: [-0.10, 0.04, 0.03], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.02, 0],
  },
  // "HandAway" is ASL-LEX's code for articulated NEAR the non-dominant hand
  // without contacting it - AGAIN, STUDY, WHEN and CODE all work in the space
  // just above the base hand. It is still a relation: the two hands must stay in
  // register, so an absolute anchor is wrong. The clearance is what makes it
  // read as proximity rather than contact.
  HandAway: {
    offset: [0.12, 0.17, 0.05], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, -0.06, 0.01],
  },
  // --- the non-dominant ARM as a surface ---------------------------------
  // HOSPITAL, MUSCLE and ENERGY are on the upper arm; LONG, TABLE and IMPROVE
  // run along the forearm; SON and DAUGHTER finish at the crook of the elbow.
  // These are still relations, not absolute places: the base arm is held across
  // the body and the dominant hand must track it. Offsets run from the base
  // WRIST toward the elbow, which is further out on the non-dominant side.
  ForearmFront: {
    offset: [-0.16, 0.05, 0.03], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.10, 0.00, 0.00],
  },
  ForearmBack: {
    offset: [-0.16, 0.05, -0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.10, 0.00, 0.00],
  },
  ForearmUlnar: {
    offset: [-0.16, 0.09, 0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.08, 0.00, 0.00],
  },
  ForearmRadial: {
    offset: [-0.16, 0.01, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.08, 0.00, 0.00],
  },
  ElbowFront: {
    offset: [-0.30, 0.04, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.00, 0.00],
  },
  ElbowBack: {
    offset: [-0.30, 0.04, -0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.00, 0.00],
  },
  UpperArm: {
    offset: [-0.34, 0.10, 0.00], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: [0.52, -0.72, 0.46], travel: [0.02, 0.02, 0.00],
  },
  // Off the arm, in the space beside it.
  ArmAway: {
    offset: [-0.08, 0.16, 0.06], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.04, -0.04, 0.01],
  },
  // ASL-LEX codes "Other" when the contact surface did not fit its categories.
  // The two hands are still related, so a proximal relation keeps them in
  // register; it just cannot claim which surface is involved.
  Other: {
    offset: [0.10, 0.12, 0.04], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.02, 0.01],
  },
}

/**
 * Relations that a surface name alone cannot express, selected by the
 * `hand_relation` field in data/asl_custom_motions.json.
 */
export const NAMED_RELATIONS: Record<string, HandRelation> = {
  on_palm: HAND_SURFACE.Palm,
  on_back: HAND_SURFACE.PalmBack,
  on_radial: HAND_SURFACE.FingerRadial,
  on_tip: HAND_SURFACE.FingerTip,
  on_heel: HAND_SURFACE.Heel,
  on_wrist: HAND_SURFACE.WristBack,
  on_forearm: HAND_SURFACE.ForearmBack,
  on_upper_arm: HAND_SURFACE.UpperArm,
  above: HAND_SURFACE.HandAway,
  /** Both hands angled, meeting across each other rather than stacked. */
  crossed: {
    offset: [0.10, 0.10, 0.02],
    basePalm: [0.14, -0.30, 0.94], basePoint: [0.92, 0.28, 0.27],
    meetPalm: [0.08, -0.92, 0.38], travel: [0, 0.02, 0],
  },
  /** Index tips or fingertips touching in front of the body. */
  tip_to_tip: {
    offset: [0.20, 0.06, 0.02],
    basePalm: [0.36, 0.20, 0.91], basePoint: [0.90, 0.36, 0.24],
    meetPalm: [-0.36, -0.22, 0.91], travel: [0.02, 0, 0],
  },
  /** Side by side, not in contact. */
  beside: {
    offset: [0.26, 0.00, 0.00],
    basePalm: [0.10, 0.10, 0.99], basePoint: [0.20, 0.96, 0.18],
    meetPalm: [-0.10, 0.10, 0.99],
  },
}

/** Resolve a relation from the licensed surface name, or an authored override. */
export function relationFor(
  minor?: string | null,
  override?: string | null,
): HandRelation | null {
  if (override && NAMED_RELATIONS[override]) return NAMED_RELATIONS[override]
  if (minor && HAND_SURFACE[minor]) return HAND_SURFACE[minor]
  return null
}

/**
 * Preferred elbow plane. A high sign needs the elbow to open laterally while a
 * neutral sign keeps it low; one global IK pole makes every arm form the same
 * mannequin right angle. Keyed to MajorLocation.
 */
export const ELBOW_BY_LOCATION: Record<string, Vec3> = {
  // A raised elbow still hangs mostly DOWN. Poling it almost fully lateral
  // threw the elbow out sideways to reach a face anchor that was itself too far
  // out; with the anchors corrected the pole can sit where a signer's does.
  Head: [0.52, -0.74, -0.16],
  Body: [0.42, -0.90, -0.16],
  Hand: [0.52, -0.78, -0.12],
  Arm: [0.58, -0.72, -0.18],
  Neutral: [0.48, -0.84, -0.16],
  Other: [0.48, -0.84, -0.16],
}

/**
 * Default palm and finger direction by MajorLocation. Palm orientation is one
 * of the five classical ASL parameters and is NOT among the ASL-LEX columns, so
 * everything here is an authored interpretive layer over the licensed data.
 */
export const ORIENTATION_BY_LOCATION: Record<string, { palm: Vec3; point: Vec3 }> = {
  Head: { palm: [0, 0.20, -0.96], point: [0, 1, 0] },
  Hand: { palm: [0, -0.90, 0.44], point: [0.10, 0.20, 0.97] },
  Body: { palm: [0, 0, -1], point: [0.10, 0.90, 0.40] },
  Arm: { palm: [0, -0.80, 0.60], point: [-0.90, 0.20, 0.40] },
  Neutral: { palm: [0, 0, 1], point: [0.10, 0.95, 0.30] },
  Other: { palm: [0, 0, 1], point: [0.10, 0.95, 0.30] },
}

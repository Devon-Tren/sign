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

  // --- head, neck, torso: SURFACE points --------------------------------
  // Measured from the skinned mesh (artifacts/rig-verify/landmarks.mjs). These
  // are where the hand's CONTACT POINT goes (fingertips, thumb tip or palm -
  // see ArmPose.reach in ./clips), not wrist positions. Wrist-position anchors
  // tuned by eye put the wrist at the face, which bent the wrist ~35 degrees
  // on typical signs and sank the forearm into the chest for chin signs.
  // Slightly toward the dominant side of the midline, as one-handed signs are.
  Head: [0.05, 0.45, 0.25],
  HeadTop: [0.04, 0.72, 0.10],
  Forehead: [0.05, 0.56, 0.235],
  Eye: [0.08, 0.47, 0.225],
  CheekNose: [0.10, 0.39, 0.215],
  UpperLip: [0.02, 0.35, 0.268],
  Mouth: [0.02, 0.32, 0.262],
  Chin: [0.02, 0.26, 0.245],
  UnderChin: [0.02, 0.22, 0.15],
  // Off the head, out in space beside it: palm centre, not a surface.
  HeadAway: [0.36, 0.34, 0.42],

  Neck: [0.03, 0.18, 0.11],
  Clavicle: [0.14, 0.02, 0.21],
  Shoulder: [0.31, 0.06, 0.08],
  Body: [0.10, -0.28, 0.335],
  TorsoTop: [0.11, -0.12, 0.29],
  TorsoMid: [0.10, -0.28, 0.335],
  TorsoBottom: [0.10, -0.46, 0.37],
  Waist: [0.15, -0.55, 0.37],
  Hips: [0.22, -0.66, 0.35],
  BodyAway: [0.28, -0.28, 0.62],

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

/** Locations whose anchor is a point on the body surface (contact point goes
 *  there); everything else is a point in space (palm centre goes there). */
export const SURFACE_LOCATIONS = new Set(['Head', 'HeadTop', 'Forehead', 'Eye', 'CheekNose', 'UpperLip',
  'Mouth', 'Chin', 'UnderChin', 'Neck', 'Clavicle', 'Shoulder', 'Body', 'TorsoTop', 'TorsoMid',
  'TorsoBottom', 'Waist', 'Hips', 'Chest', 'Cheek', 'Nose'])

/**
 * Front of the torso (arm-reach units) at height y, from the mesh: collarbone
 * 0.21, upper chest 0.28, chest 0.33, jacket front at the waist 0.36. Used to
 * keep a derived wrist, and transitions, out of the body.
 */
export function torsoFrontZ(y: number): number {
  const table: [number, number][] = [[0.12, 0.10], [0.05, 0.19], [0, 0.21], [-0.1, 0.28], [-0.2, 0.325], [-0.3, 0.33], [-0.4, 0.36], [-0.9, 0.36]]
  if (y >= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [y0, z0] = table[i - 1], [y1, z1] = table[i]
    if (y >= y1) return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
  }
  return table[table.length - 1][1]
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
  /**
   * The surface point on the BASE hand, in its own frame: along the fingers
   * from the wrist, toward the thumb side, out of the palm (arm-reach units;
   * the B hand measures 0.356 wrist-to-fingertip). The dominant hand's
   * contact part (`reach`) goes there, so the dominant wrist is derived from
   * real hand geometry rather than an authored wrist offset, which bent the
   * wrist ~50 degrees on the ~360 signs made on the other hand.
   */
  at?: Vec3
  reach?: { tip?: number; thumb?: number; palm?: number }
}

// The base hand's fingers point forward and across, continuing its forearm;
// straight across (0.96, 0.06, 0.26) needed ~70 degrees of sideways wrist bend.
const POINT_ACROSS: Vec3 = [0.60, 0.05, 0.80]
const PALM_UP: Vec3 = [-0.06, 0.998, 0.03]
const PALM_DOWN: Vec3 = [0.06, -0.998, -0.03]
const PALM: { palm: number } = { palm: 1 }
const FINGERS: { tip: number; palm: number } = { tip: 0.5, palm: 0.5 }
const TIPS: { tip: number } = { tip: 1 }

export const HAND_SURFACE: Record<string, HandRelation> = {
  // Base palm up, dominant hand lands on it from above.
  Palm: {
    offset: [0.05, 0.05, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.05, 0.02],
    at: [0.12, 0, 0.02], reach: PALM,
  },
  // Base palm down, dominant hand works on the back of it.
  PalmBack: {
    offset: [0.05, 0.06, 0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.03, 0.01],
    at: [0.12, 0, -0.03], reach: PALM,
  },
  // The heel of the base palm, nearer the wrist.
  Heel: {
    offset: [-0.04, 0.05, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.05, 0.02, 0.01],
    at: [0.04, 0, 0.02], reach: PALM,
  },
  // The front (palm side) of the base fingers.
  FingerFront: {
    offset: [0.12, 0.05, 0.03], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.03, 0.01],
    at: [0.26, 0, 0.015], reach: FINGERS,
  },
  FingerBack: {
    offset: [0.12, 0.05, -0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.02, 0.01],
    at: [0.26, 0, -0.02], reach: FINGERS,
  },
  // The thumb-side edge of the base fingers. NAME crosses the H-hands here,
  // which is why an offset near the wrists produced the crossed-hand artifact.
  FingerRadial: {
    offset: [0.10, 0.09, 0.02], basePalm: [0.10, -0.32, 0.94], basePoint: POINT_ACROSS,
    meetPalm: [0.06, -0.94, 0.33], travel: [0, 0.02, 0],
    at: [0.24, 0.05, 0], reach: FINGERS,
  },
  // The little-finger-side edge.
  FingerUlnar: {
    offset: [0.02, 0.11, 0.02], basePalm: [0.12, 0.34, 0.93], basePoint: POINT_ACROSS,
    meetPalm: [0.04, -0.92, 0.39], travel: [0, 0.02, 0],
    at: [0.22, -0.05, 0], reach: FINGERS,
  },
  // Fingertips meeting fingertips, like a roof: both hands' fingers point
  // forward and inward, palms angled toward each other and the signer. The
  // old base/meet palms were ~17 degrees out of reach from diagonal hands.
  FingerTip: {
    offset: [0.18, 0.07, 0.02], basePalm: [0.8, 0, -0.6], basePoint: POINT_ACROSS,
    meetPalm: [-0.8, 0, -0.6], travel: [0.02, 0.02, 0],
    at: [0.36, 0, 0], reach: TIPS,
  },
  WristBack: {
    offset: [-0.10, 0.04, 0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.02, 0],
    at: [-0.02, 0, -0.03], reach: PALM,
  },
  WristFront: {
    offset: [-0.10, 0.04, 0.03], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.02, 0.02, 0],
    at: [-0.02, 0, 0.025], reach: PALM,
  },
  // "HandAway" is ASL-LEX's code for articulated NEAR the non-dominant hand
  // without contacting it - AGAIN, STUDY, WHEN and CODE all work in the space
  // just above the base hand. It is still a relation: the two hands must stay in
  // register, so an absolute anchor is wrong. The clearance is what makes it
  // read as proximity rather than contact.
  HandAway: {
    offset: [0.12, 0.17, 0.05], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, -0.06, 0.01],
    at: [0.14, 0, 0.14], reach: PALM,
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
    at: [-0.2, 0, 0.03], reach: PALM,
  },
  ForearmBack: {
    offset: [-0.16, 0.05, -0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.10, 0.00, 0.00],
    at: [-0.2, 0, -0.04], reach: PALM,
  },
  ForearmUlnar: {
    offset: [-0.16, 0.09, 0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.08, 0.00, 0.00],
    at: [-0.2, -0.04, 0], reach: PALM,
  },
  ForearmRadial: {
    offset: [-0.16, 0.01, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.08, 0.00, 0.00],
    at: [-0.2, 0.04, 0], reach: PALM,
  },
  ElbowFront: {
    offset: [-0.30, 0.04, 0.02], basePalm: PALM_UP, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.00, 0.00],
    at: [-0.45, 0, 0.03], reach: PALM,
  },
  ElbowBack: {
    offset: [-0.30, 0.04, -0.01], basePalm: PALM_DOWN, basePoint: POINT_ACROSS,
    meetPalm: PALM_DOWN, travel: [0.03, 0.00, 0.00],
    at: [-0.45, 0, -0.05], reach: PALM,
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
    at: [0.14, 0, 0.08], reach: PALM,
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
    at: [0.24, 0.05, 0], reach: FINGERS,
  },
  /** Index tips or fingertips touching in front of the body (roof, as FingerTip). */
  tip_to_tip: {
    offset: [0.20, 0.06, 0.02],
    basePalm: [0.8, 0, -0.6], basePoint: POINT_ACROSS,
    meetPalm: [-0.8, 0, -0.6], travel: [0.02, 0, 0],
    at: [0.36, 0, 0], reach: TIPS,
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
  // Forward and down: for face signs the elbow comes up IN FRONT of the chest,
  // not out to the side (which read as a flared "chicken wing").
  Head: [0.2, -0.65, 0.73],
  // Down and slightly forward: for chest signs the elbow hangs near the side,
  // it does not wing out.
  Body: [0.25, -0.92, 0.30],
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
  // Fingertips meet the face with the fingers tilted back toward it and the
  // palm toward the signer, so the wrist sits forward of the chest (straight
  // up put the forearm inside it once the fingertips, not the wrist, contact).
  // Fingers also lean slightly toward the midline, following a forearm that
  // rises from the dominant side.
  Head: { palm: [0, -0.38, -0.92], point: [-0.25, 0.9, -0.35] },
  // On the other hand: dominant fingers forward and across toward the
  // non-dominant side, continuing the dominant forearm and crossing the base
  // hand (SCHOOL, PAPER). Straight forward bent the wrist ~58 degrees sideways.
  Hand: { palm: [0, -0.90, 0.44], point: [-0.50, 0.10, 0.86] },
  // Palm on the chest, fingers following the forearm up and across toward
  // the non-dominant shoulder. Fingers straight up needed a wrist flexion the
  // joint cannot give, leaving torso signs ~35 degrees off their palm.
  Body: { palm: [-0.17, 0.11, -0.98], point: [-0.83, 0.52, 0.21] },
  Arm: { palm: [0, -0.80, 0.60], point: [-0.90, 0.20, 0.40] },
  // ASL-LEX codes no orientation. Palm-out/fingers-up for every neutral sign
  // demanded near-maximal wrist extension with the forearm angled forward (the
  // wrist sat at its limit, palm ~29 degrees off, the "broken wrist" look). The
  // default is now the relaxed forearm: fingers continuing it forward and up,
  // palm toward the non-dominant side and slightly down. Signs with data
  // (ASL-Phono priors, overrides) keep theirs.
  Neutral: { palm: [-0.96, -0.28, 0.01], point: [-0.15, 0.55, 0.82] },
  Other: { palm: [-0.96, -0.28, 0.01], point: [-0.15, 0.55, 0.82] },
}

/** ASL-LEX location names meaning "off the body, out in space". */
const AWAY = /Away$/

/**
 * Starting palm and finger direction for a sign.
 *
 * Palm orientation is one of the five classical ASL parameters and ASL-LEX does
 * not code it, so every value here is interpretation. What it must not be is
 * one constant per region: that gave all 340 head-located signs the same palm
 * vector, facing the signer's own face, which is 180 degrees wrong for any sign
 * that presents outward.
 *
 * The legacy "...Away" heuristic below is only a fallback, not a linguistic
 * rule: leaving the body does NOT determine palm orientation (SEE and BETTER
 * are counterexamples). Authored orientations and accepted priors take
 * precedence in clips.ts. Retain this approximation for unreviewed entries
 * until their citation variants can be checked rather than flipping them all.
 */
/** The open-5 thumb-contact family (MOTHER/FATHER): the THUMB tip touches. */
export function thumbContactFamily(
  major?: string | null, second?: string | null,
  form?: { Handshape: string | null; SignType: string | null; MinorLocation: string | null;
    Contact?: string | null; ThumbPosition?: string | null; FlexionChange?: string | null },
): boolean {
  return major === 'Head' && form?.Handshape === '5' && form.SignType === 'OneHanded'
    && form.Contact === '1' && form.ThumbPosition === 'Open' && form.FlexionChange === '0'
    && (form.MinorLocation === 'Forehead' || form.MinorLocation === 'Chin')
    && (!second || second === 'NA')
}

export function orientationFor(
  major?: string | null,
  second?: string | null,
  form?: { Handshape: string | null; SignType: string | null; MinorLocation: string | null;
    Contact?: string | null; ThumbPosition?: string | null; FlexionChange?: string | null },
): { palm: Vec3; point: Vec3 } {
  // The open-5 thumb-contact family (MOTHER/FATHER and their compound
  // morphemes) presents its palm toward the non-dominant side. A head region
  // alone cannot distinguish this from fingertips touching the face. This
  // narrowly scoped authored inference excludes changing-finger COLOR and
  // two-handed chin signs such as HATE; ASL-LEX does not code contact digits.
  // Fingers tilted slightly forward, which swings the resting thumb up and
  // lets the wrist sit lower and closer: straight up
  // held the wrist ~0.2 in front of the forehead at eye height, forcing the
  // elbow up to shoulder level.
  if (thumbContactFamily(major, second, form)) return { palm: [-1, 0, 0], point: [0, 0.88, 0.47] }
  const base = ORIENTATION_BY_LOCATION[major ?? 'Neutral'] ?? ORIENTATION_BY_LOCATION.Neutral
  if (!second || second === 'NA' || !AWAY.test(second)) return base
  // Turn the palm out without discarding the region's own character: keep the
  // lateral component, halve the vertical, and flip the forward component so it
  // presents to the addressee.
  return {
    palm: [base.palm[0], base.palm[1] * 0.5, Math.abs(base.palm[2])],
    point: base.point,
  }
}

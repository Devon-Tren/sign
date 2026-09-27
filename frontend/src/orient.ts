/**
 * Hand-orientation math shared by pose blending (./clips) and transition
 * scheduling (./sequence). A hand orientation is the frame (point = +y,
 * palm = +z); it is interpolated as ONE rotation.
 */
import { pointForPalm } from './phono'

type Vec3 = readonly [number, number, number]
const normalise = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

export type Quat = readonly [number, number, number, number]

/** Rotation taking the canonical hand frame (fingers +y, palm +z) to (point, palm). */
export function frameQuat(palm: Vec3, point: Vec3): Quat {
  const z = normalise(palm)
  const y = normalise(pointForPalm(z, point))
  const x: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]]
  const trace = x[0] + y[1] + z[2]
  let q: [number, number, number, number]
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4]
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s]
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s]
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s]
  }
  return q
}

export function quatSlerp(a: Quat, b: Quat, t: number, longArc = false): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  // Long = the opposite choice from short, including at exactly 180 degrees
  // (d == 0), where "d > 0" and "d < 0" were both false and gave one path.
  const shortFlip = d < 0
  const flip = longArc ? !shortFlip : shortFlip
  const bb = flip ? b.map(v => -v) as unknown as Quat : b
  d = flip ? -d : d
  if (d > 0.9995) {
    const l = a.map((v, i) => v + (bb[i] - v) * t)
    const n = Math.hypot(...l) || 1
    return l.map(v => v / n) as unknown as Quat
  }
  const th = Math.acos(d), sn = Math.sin(th)
  const wa = Math.sin((1 - t) * th) / sn, wb = Math.sin(t * th) / sn
  return a.map((v, i) => v * wa + bb[i] * wb) as unknown as Quat
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2]
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x]
}

/**
 * Interpolate the whole hand orientation as ONE rotation. Slerping palm and
 * finger directions separately and re-orthogonalising let the interpolated
 * finger vector pass near the palm normal mid-blend, where the projection is
 * near-degenerate: measured 24 degrees of finger swing per 8 ms frame (~50
 * rad/s) in rest-to-sign transitions, which exact tracking shows as a flip.
 */
export function blendOrientation(aPalm: Vec3, aPoint: Vec3, bPalm: Vec3, bPoint: Vec3, t: number) {
  const q = quatSlerp(frameQuat(aPalm, aPoint), frameQuat(bPalm, bPoint), t)
  return { palm: normalise(quatRotate(q, [0, 0, 1])), point: normalise(quatRotate(q, [0, 1, 0])) }
}


/** Finger direction z below which a transition is sweeping into the body. */
const BRIDGE_BACKWARD = 0.1

/**
 * Which way a TRANSITION turns the hand, and by how much.
 *
 * Each way round is judged by what the FOREARM would have to do: along each
 * candidate path, the twist each orientation needs about a nominal forearm
 * (elbow down at the side, wrist on the interpolated target) is compared with
 * the anatomical range, pronation 85 deg to supination 90 deg. The path that
 * stays in range wins; ties prefer the one that does not sweep the fingers
 * back into the body, then the shorter. Heuristics about "forward" or
 * "pronation direction" each broke some transition (GOOD -> MORNING's palm
 * flip, IDEA's forehead -> rest pitch ran the request past full supination
 * and the forearm switched ends mid-move).
 */
export function bridgeArc(aPalm: Vec3, aPoint: Vec3, bPalm: Vec3, bPoint: Vec3, side: 1 | -1 = 1,
  aTarget?: Vec3, bTarget?: Vec3) {
  const qa = frameQuat(aPalm, aPoint), qb = frameQuat(bPalm, bPoint)
  const d = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]))
  const short = 2 * Math.acos(d)
  const judge = (long: boolean) => {
    let overshoot = 0, backward = 0
    for (const t of [0.25, 0.5, 0.75]) {
      const q = quatSlerp(qa, qb, t, long)
      const palm = quatRotate(q, [0, 0, 1]), point = quatRotate(q, [0, 1, 0])
      backward = Math.max(backward, -point[2])
      if (aTarget && bTarget) {
        const w: Vec3 = [aTarget[0] + (bTarget[0] - aTarget[0]) * t, aTarget[1] + (bTarget[1] - aTarget[1]) * t,
          aTarget[2] + (bTarget[2] - aTarget[2]) * t]
        const phi = forearmTwist(palm, w, side)
        if (phi !== null) overshoot = Math.max(overshoot, phi - SUPINATION_MAX, PRONATION_MAX - phi)
      }
    }
    return { overshoot: Math.max(0, overshoot), backward }
  }
  const s0 = judge(false), s1 = judge(true)
  let long: boolean
  if (Math.abs(s0.overshoot - s1.overshoot) > 0.15) long = s1.overshoot < s0.overshoot
  else if ((s0.backward > BRIDGE_BACKWARD) !== (s1.backward > BRIDGE_BACKWARD)) long = s0.backward > BRIDGE_BACKWARD
  else long = false
  return { long, angle: long ? 2 * Math.PI - short : short }
}

/** Nominal shoulder and elbow (body frame) for the twist estimate. */
const SHOULDER: Vec3 = [0.35, 0, 0], ELBOW: Vec3 = [0.4, -0.45, 0.12]
const SUPINATION_MAX = Math.PI / 2, PRONATION_MAX = -85 * Math.PI / 180

/**
 * Physiological forearm twist (radians, + = supination) a palm direction needs
 * with the wrist at `wrist`, relative to the thumb-up neutral of the solver
 * (palm normal = upper x fore, mirrored for the other arm). Null when the
 * forearm is degenerate.
 */
function forearmTwist(palm: Vec3, wrist: Vec3, side: 1 | -1): number | null {
  const sx = side
  const shoulder: Vec3 = [SHOULDER[0] * sx, SHOULDER[1], SHOULDER[2]]
  const elbow: Vec3 = [ELBOW[0] * sx, ELBOW[1], ELBOW[2]]
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const fore = normalise(sub(wrist, elbow)), upper = normalise(sub(elbow, shoulder))
  const n0 = cross(upper, fore)
  if (Math.hypot(...n0) < 1e-3) return null
  const neutral = normalise([n0[0] * sx, n0[1] * sx, n0[2] * sx])
  const p = normalise(sub(palm, [fore[0] * dot(palm, fore), fore[1] * dot(palm, fore), fore[2] * dot(palm, fore)]))
  const signed = Math.atan2(dot(cross(neutral, p), fore), dot(neutral, p))
  return -sx * signed
}

/** Wrist z (arm reach) a transition keeps in front of the torso: surface plus finger length. */
const BRIDGE_CLEARANCE = 0.65

/**
 * How far a straight wrist path between two targets dips behind the envelope
 * in front of the torso. The transition arcs forward by this much (a sine bump,
 * zero at both ends), and ./sequence sizes the transition to include the arc.
 */
export function bridgeClearance(a: Vec3, b: Vec3): number {
  let deficit = 0
  for (let k = 1; k < 8; k++) {
    const t = k / 8
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    if (Math.abs(p[0]) < 0.42 && p[1] > -0.88 && p[1] < 0.08) deficit = Math.max(deficit, BRIDGE_CLEARANCE - p[2])
    // The face: a straight path between two points on it (PARENTS at the
    // forehead to DEAF at the cheek) is a chord through the head. The safety
    // audit measured the wrist 8 cm inside the head on exactly that move.
    if (Math.abs(p[0]) < HEAD_HALF_WIDTH && p[1] > 0.12 && p[1] < 0.74) {
      deficit = Math.max(deficit, headFrontZ(p[1]) + HEAD_BRIDGE_MARGIN - p[2])
    }
  }
  return deficit
}

/** Half-width of the face (arm reach) inside which a path must pass in front of it. */
const HEAD_HALF_WIDTH = 0.17
/** How far in front of the face a mid-transition contact point stays (~2.5 cm). */
const HEAD_BRIDGE_MARGIN = 0.05
/**
 * Front of the face (arm reach) at height y, from the ./anchors surface points
 * (chin 0.245, lips 0.268, eyes 0.225, forehead 0.235) plus the nose, which
 * stands forward of them at the midline.
 */
function headFrontZ(y: number): number {
  const table: [number, number][] = [[0.74, 0.08], [0.64, 0.19], [0.56, 0.235], [0.47, 0.235], [0.40, 0.30],
    [0.35, 0.27], [0.26, 0.245], [0.2, 0.17], [0.12, 0.11]]
  for (let i = 1; i < table.length; i++) {
    const [y0, z0] = table[i - 1], [y1, z1] = table[i]
    if (y >= y1) return z0 + (z1 - z0) * (y0 - y) / (y0 - y1)
  }
  return table[table.length - 1][1]
}

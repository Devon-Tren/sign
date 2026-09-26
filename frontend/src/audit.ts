/**
 * Catalog self-audit.
 *
 * The motion catalog had no way to be inspected as a whole, so defects that are
 * obvious in aggregate stayed invisible one sign at a time. Two of them had been
 * shipping: `closed_b`, `flat_b` and `b` resolved to byte-identical hand poses,
 * and the manual alphabet resolved 26 letters onto 13 distinct shapes, on the
 * code path that renders every unsupported word.
 *
 * Everything here is a pure function over the composed pose data, so a
 * collision is a number rather than a judgement call about a screenshot.
 */
import {
  ASL_LEX_HANDSHAPES, BASE_FORMS, FINGERSPELL, composeHandshape,
  handshapeFor, parseHandshapeName, type HandPose,
} from './handshapes'
import { ANCHORS, isHandLocated, relationFor } from './anchors'
import {
  allSignIds, augmentFor, clipLengthMs, motionFor, signParams,
  type Morpheme, type SignParams,
} from './clips'
import { acceptedDirection, phonoPriorFor } from './phono'

/** Flatten a hand pose to a comparable vector: 4 fingers x (3 curl + spread) + thumb. */
export function handVector(pose: HandPose): number[] {
  const out: number[] = []
  for (const finger of pose.fingers) out.push(...finger.curl, finger.spread)
  out.push(pose.thumb.abduct, pose.thumb.rotate, ...pose.thumb.curl)
  return out
}

/** Largest per-component difference between two hand poses, in radians. */
export function handDistance(a: HandPose, b: HandPose): number {
  const va = handVector(a), vb = handVector(b)
  let worst = 0
  for (let i = 0; i < Math.min(va.length, vb.length); i++) {
    worst = Math.max(worst, Math.abs(va[i] - vb[i]))
  }
  return worst
}

export type Collision = { a: string; b: string; distance: number }

/**
 * Two handshapes closer than this are not visually distinguishable on a hand a
 * few hundred pixels tall. 0.05 rad is under three degrees per joint.
 */
export const DISTINCT_THRESHOLD = 0.05

/**
 * Pairs that are SUPPOSED to share a pose. ASL-LEX codes P as the K handshape
 * rotated to point downward, so they are one handshape plus an orientation;
 * FINGERSPELL separates them and fingerspellCollisions() verifies that.
 */
export const EXPECTED_SHARED_POSE: readonly (readonly [string, string])[] = [
  ['k', 'p'],
]
const expected = new Set(EXPECTED_SHARED_POSE.map(([a, b]) => [a, b].sort().join('|')))

/** Pairs of named handshapes that render as the same pose. */
export function handshapeCollisions(
  names: readonly string[] = ASL_LEX_HANDSHAPES,
  threshold = DISTINCT_THRESHOLD,
): Collision[] {
  const posed = names.map((name) => ({ name, pose: composeHandshape(name) }))
  const out: Collision[] = []
  for (let i = 0; i < posed.length; i++) {
    for (let j = i + 1; j < posed.length; j++) {
      const distance = handDistance(posed[i].pose, posed[j].pose)
      if (distance >= threshold) continue
      if (expected.has([posed[i].name, posed[j].name].sort().join('|'))) continue
      out.push({ a: posed[i].name, b: posed[j].name, distance })
    }
  }
  return out.sort((x, y) => x.distance - y.distance)
}

/**
 * Letters of the manual alphabet that cannot be told apart. Two letters may
 * legitimately share a HANDSHAPE (H and U, G and Q, I and J) as long as palm or
 * pointing direction separates them, so orientation counts here too.
 */
export function fingerspellCollisions(threshold = DISTINCT_THRESHOLD): Collision[] {
  const letters = Object.keys(FINGERSPELL).filter((k) => /^[A-Z]$/.test(k))
  const out: Collision[] = []
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  for (let i = 0; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      const A = FINGERSPELL[letters[i]], B = FINGERSPELL[letters[j]]
      const shapeGap = handDistance(handshapeFor(A.shape), handshapeFor(B.shape))
      // Orientation difference, as one minus the cosine similarity of both axes.
      const orientGap = (1 - dot(A.palm, B.palm)) + (1 - dot(A.point, B.point))
      const traceGap = (A.trace ?? '') === (B.trace ?? '') ? 0 : 1
      const total = shapeGap + orientGap + traceGap
      if (total < threshold) out.push({ a: letters[i], b: letters[j], distance: total })
    }
  }
  return out.sort((x, y) => x.distance - y.distance)
}

export type CatalogIssue = {
  sign: string
  kind:
    | 'no-descriptors'
    | 'unknown-handshape'
    | 'unknown-base-form'
    | 'unknown-location'
    | 'hand-located-without-relation'
    | 'approximate-mapping'
    | 'no-movement-for-relocation'
    | 'static-path'
    | 'path-free-internal-movement'
    | 'invalid-pose'
  detail: string
}

function morphemesOf(sign: SignParams): Morpheme[] {
  return sign.morphemes && sign.morphemes.length ? sign.morphemes : [sign]
}

/** Every catalog entry, checked against the vocabularies the renderer covers. */
export function catalogIssues(): CatalogIssue[] {
  const out: CatalogIssue[] = []
  for (const id of allSignIds()) {
    const sign = signParams(id)
    if (!sign) continue

    if (sign.app_authored) {
      out.push({
        sign: id, kind: 'no-descriptors',
        detail: 'App-authored approximation; no published phonological descriptor is mapped.',
      })
    }
    if (sign.fidelity === 'approximate') {
      out.push({
        sign: id, kind: 'approximate-mapping',
        detail: sign.mapping_note
          ?? `Mapped to ASL-LEX ${sign.asl_lex_entry}, which is not the same sign.`,
      })
    }

    for (const [index, m] of morphemesOf(sign).entries()) {
      const where = morphemesOf(sign).length > 1 ? ` (morpheme ${index + 1})` : ''

      if (m.Handshape) {
        const { base } = parseHandshapeName(m.Handshape)
        if (!BASE_FORMS[base]) {
          out.push({
            sign: id, kind: 'unknown-base-form',
            detail: `Handshape "${m.Handshape}" parses to base "${base}", which has no base form${where}.`,
          })
        }
      } else {
        out.push({ sign: id, kind: 'unknown-handshape', detail: `No handshape coded${where}.` })
      }

      for (const [field, value] of [
        ['MinorLocation', m.MinorLocation],
        ['SecondMinorLocation', m.SecondMinorLocation],
      ] as const) {
        if (value && value !== 'NA' && !(value in ANCHORS)) {
          out.push({
            sign: id, kind: 'unknown-location',
            detail: `${field} "${value}" has no anchor${where}.`,
          })
        }
      }

      if (isHandLocated(m.MinorLocation, m.MajorLocation)) {
        const relation = relationFor(m.MinorLocation, augmentFor(id).hand_relation)
        if (!relation) {
          out.push({
            sign: id, kind: 'hand-located-without-relation',
            detail: `Articulated on the non-dominant hand at "${m.MinorLocation}" `
              + `but no relation resolves, so it falls back to an absolute anchor${where}.`,
          })
        }
      }

      if (index === 0 && pathLength(id) < STATIC_PATH_THRESHOLD) {
        const internal = internalMovement(id)
        out.push({
          sign: id, kind: internal ? 'path-free-internal-movement' : 'static-path',
          detail: internal
            ? `Little wrist travel; ${internal} changes during the sign. Compare with reference video.`
            : `Little wrist travel and no measured internal movement (Movement=${m.Movement}). `
              + 'Needs reference review; a static path alone does not prove a defective sign.',
        })
      }

      const relocates = !!m.SecondMinorLocation
        && m.SecondMinorLocation !== 'NA'
        && m.SecondMinorLocation !== m.MinorLocation
      if (relocates && (m.Movement === 'None' || !m.Movement)) {
        out.push({
          sign: id, kind: 'no-movement-for-relocation',
          detail: `Relocates ${m.MinorLocation} -> ${m.SecondMinorLocation} `
            + `but Movement is "${m.Movement ?? 'null'}"${where}.`,
        })
      }
    }
  }
  for (const id of allSignIds()) {
    for (const fraction of [0, 0.15, 0.35, 0.65, 0.9]) {
      const pose = motionFor(id, clipLengthMs(id) * fraction / 1000)
      const values = [
        ...handVector(pose.rightHand), ...handVector(pose.leftHand), ...pose.head,
        ...[pose.rightArm, pose.leftArm].flatMap(a => a ? [...a.target, ...a.palm, ...a.point] : []),
      ]
      if (values.some(v => !Number.isFinite(v))) {
        out.push({ sign: id, kind: 'invalid-pose', detail: `Non-finite pose at ${fraction} of clip.` })
        break
      }
    }
  }
  return out
}

/** A still wrist can accompany changing fingers or palm orientation. */
export function internalMovement(id: string): string | null {
  const total = clipLengthMs(id)
  const first = motionFor(id, total * 0.15 / 1000)
  let fingers = false, orientation = false
  for (let i = 1; i <= 24; i++) {
    const pose = motionFor(id, total * (0.15 + 0.6 * i / 24) / 1000)
    fingers ||= handDistance(first.rightHand, pose.rightHand) > DISTINCT_THRESHOLD
      || handDistance(first.leftHand, pose.leftHand) > DISTINCT_THRESHOLD
    for (const side of ['rightArm', 'leftArm'] as const) {
      const a = first[side], b = pose[side]
      if (a && b) orientation ||= Math.hypot(...a.palm.map((v, j) => v - b.palm[j])) > 0.05
        || Math.hypot(...a.point.map((v, j) => v - b.point[j])) > 0.05
    }
  }
  return [fingers ? 'handshape' : '', orientation ? 'orientation' : ''].filter(Boolean).join(' and ') || null
}

/** Measure actual application, including overrides/contact/compound exclusions. */
export function priorUsage(id: string): { orientation: boolean; movement: boolean } {
  let orientation = false, movement = false
  if (!phonoPriorFor(id)) return { orientation, movement }
  for (const fraction of [0.25, 0.45, 0.65]) {
    const at = clipLengthMs(id) * fraction / 1000
    const a = motionFor(id, at).rightArm
    const b = motionFor(id, at, { usePhonoPriors: false }).rightArm
    if (!a || !b) continue
    orientation ||= Math.hypot(...a.palm.map((v, j) => v - b.palm[j])) > 1e-6
    movement ||= Math.hypot(...a.target.map((v, j) => v - b.target[j])) > 1e-6
  }
  return { orientation, movement }
}

/**
 * Distance the dominant hand actually travels across the sign, in reach units.
 *
 * ASL-LEX codes a local path as Straight with no second location, which used to
 * render as a hand that arrives somewhere and freezes - 628 signs were still
 * photographs. This measures the RENDERED trajectory rather than the descriptor,
 * so a primitive that silently returns a zero offset is caught.
 */
export function pathLength(id: string, samples = 12): number {
  const total = clipLengthMs(id, 'isolated')
  let travelled = 0
  let previous: readonly number[] | null = null
  for (let i = 0; i <= samples; i++) {
    // Sample across the stroke and hold, skipping onset and release.
    const at = total * (0.15 + 0.6 * (i / samples))
    const arm = motionFor(id, at / 1000, { mode: 'isolated' }).rightArm
    if (!arm) continue
    if (previous) {
      travelled += Math.hypot(
        arm.target[0] - previous[0], arm.target[1] - previous[1], arm.target[2] - previous[2],
      )
    }
    previous = arm.target
  }
  return travelled
}

/** Below this the hand is not perceptibly moving at all. */
export const STATIC_PATH_THRESHOLD = 0.02

export type AuditReport = {
  signs: number
  withDescriptors: number
  appAuthored: number
  approximate: number
  multiMorpheme: number
  handshapesCovered: number
  authoredOrientation: number
  staticPaths: number
  pathFreeInternal: number
  phonoMatched: number
  phonoOrientationAccepted: number
  phonoMovementAccepted: number
  phonoOrientationApplied: number
  phonoMovementApplied: number
  handshapeCollisions: Collision[]
  fingerspellCollisions: Collision[]
  issues: CatalogIssue[]
  byKind: Record<string, number>
}

export function auditReport(): AuditReport {
  const ids = allSignIds()
  const signs = ids.map((id) => signParams(id)!).filter(Boolean)
  const issues = catalogIssues()
  const byKind: Record<string, number> = {}
  const usage = ids.map(priorUsage)
  for (const issue of issues) byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1
  return {
    signs: ids.length,
    withDescriptors: signs.filter((s) => !s.app_authored).length,
    appAuthored: signs.filter((s) => s.app_authored).length,
    approximate: signs.filter((s) => s.fidelity === 'approximate').length,
    multiMorpheme: signs.filter((s) => (s.morphemes?.length ?? 1) > 1).length,
    handshapesCovered: ASL_LEX_HANDSHAPES.filter(
      (n) => BASE_FORMS[parseHandshapeName(n).base],
    ).length,
    authoredOrientation: ids.filter((id) => augmentFor(id).orientation).length,
    staticPaths: issues.filter((i) => i.kind === 'static-path').length,
    pathFreeInternal: issues.filter((i) => i.kind === 'path-free-internal-movement').length,
    phonoMatched: ids.filter(id => phonoPriorFor(id)).length,
    phonoOrientationAccepted: ids.filter(id => acceptedDirection(phonoPriorFor(id)?.orientation_dh)).length,
    phonoMovementAccepted: ids.filter(id => acceptedDirection(phonoPriorFor(id)?.movement_dh)).length,
    phonoOrientationApplied: usage.filter(u => u.orientation).length,
    phonoMovementApplied: usage.filter(u => u.movement).length,
    handshapeCollisions: handshapeCollisions(),
    fingerspellCollisions: fingerspellCollisions(),
    issues,
    byKind,
  }
}

/** One-line-per-finding text form, for a console or a CI log. */
export function formatAuditReport(report: AuditReport = auditReport()): string {
  const lines: string[] = []
  lines.push(`signs                ${report.signs}`)
  lines.push(`  with descriptors   ${report.withDescriptors}`)
  lines.push(`  app-authored       ${report.appAuthored}`)
  lines.push(`  approximate        ${report.approximate}`)
  lines.push(`  multi-morpheme     ${report.multiMorpheme}`)
  lines.push(`handshapes covered   ${report.handshapesCovered}/${ASL_LEX_HANDSHAPES.length}`)
  lines.push(`authored orientation ${report.authoredOrientation}`)
  lines.push(`ASL-Phono matches    ${report.phonoMatched}`)
  lines.push(`  orientation priors ${report.phonoOrientationAccepted} pass gate; ${report.phonoOrientationApplied} change playback`)
  lines.push(`  movement priors    ${report.phonoMovementAccepted} pass gate; ${report.phonoMovementApplied} change playback`)
  lines.push(`path-free / internal ${report.pathFreeInternal}`)
  lines.push(`static needs review  ${report.staticPaths}`)
  lines.push(`handshape collisions ${report.handshapeCollisions.length}`)
  for (const c of report.handshapeCollisions) {
    lines.push(`  ${c.a} = ${c.b} (max joint delta ${c.distance.toFixed(4)} rad)`)
  }
  lines.push(`letter collisions    ${report.fingerspellCollisions.length}`)
  for (const c of report.fingerspellCollisions) {
    lines.push(`  ${c.a} = ${c.b} (combined delta ${c.distance.toFixed(4)})`)
  }
  lines.push(`catalog issues       ${report.issues.length}`)
  for (const [kind, count] of Object.entries(report.byKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${kind.padEnd(30)} ${count}`)
  }
  return lines.join('\n')
}

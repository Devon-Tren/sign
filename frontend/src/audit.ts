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
import { allSignIds, augmentFor, signParams, type Morpheme, type SignParams } from './clips'

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
  return out
}

export type AuditReport = {
  signs: number
  withDescriptors: number
  appAuthored: number
  approximate: number
  multiMorpheme: number
  handshapesCovered: number
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

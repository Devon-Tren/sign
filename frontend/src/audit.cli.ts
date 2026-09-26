/**
 * Console entry point for the catalog audit. Run it with:
 *
 *     npm --prefix frontend run audit
 *
 * Exits non-zero when a handshape or letter collision is present, so a pose
 * table that loses a distinction fails CI instead of shipping.
 */
import { auditReport, formatAuditReport } from './audit'

const report = auditReport()
console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatAuditReport(report))

const collisions = report.handshapeCollisions.length + report.fingerspellCollisions.length
const invalid = report.issues.filter(i => ['invalid-pose', 'unknown-handshape', 'unknown-base-form',
  'unknown-location', 'hand-located-without-relation'].includes(i.kind)).length
if (collisions > 0 || invalid > 0) {
  console.error(`\nFAIL: ${collisions} pose collision(s), ${invalid} invalid pose/descriptor issue(s).`)
  process.exit(1)
}

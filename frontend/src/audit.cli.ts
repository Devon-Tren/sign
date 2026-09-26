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
console.log(formatAuditReport(report))

const collisions = report.handshapeCollisions.length + report.fingerspellCollisions.length
if (collisions > 0) {
  console.error(`\nFAIL: ${collisions} pose collision(s); distinct signs would render identically.`)
  process.exit(1)
}

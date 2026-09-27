import manifest from '../../data/library_motion_review.json'

export type ReviewStatus = 'updated' | 'preserved' | 'skipped'
type ReviewEntry = {label: string; status: ReviewStatus; reason: string; summary?: string; sources?: string[]}
export const libraryReview = manifest as {
  date: string; reasons: Record<string, string>; entries: Record<string, ReviewEntry>
}
export const reviewFor = (id: string): ReviewEntry | undefined => libraryReview.entries[id]
export const reviewReason = (id: string) => {
  const entry = reviewFor(id)
  return entry?.summary ?? (entry ? libraryReview.reasons[entry.reason] : 'This entry has not been reviewed yet.')
}
export const reviewLabels: Record<ReviewStatus, string> = {
  skipped: 'Needs direction', updated: 'Updated', preserved: 'Kept as requested',
}

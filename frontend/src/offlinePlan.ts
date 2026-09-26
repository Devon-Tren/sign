/**
 * Client-side fallback plan.
 *
 * `/api/plan` is what turns an arbitrary sentence into something the avatar can
 * sign: it matches catalog signs word by word and fingerspells whatever is left
 * over. When the backend is unreachable, `Live` swallowed the planner error and
 * fell back to `localInterpret`, which only knows the twelve phrases hardcoded
 * in ./data. Anything else produced an EMPTY selection - so the avatar simply
 * stood still and the UI said nothing about why.
 *
 * This mirrors the backend's fallback locally so the avatar keeps signing when
 * the planner is unavailable. It is deliberately the same shape of answer the
 * backend gives: prefer a registered sign, spell the rest, and label the result
 * a fingerspelling fallback so nothing here is presented as a translation.
 */
import { CONTINUOUS_LENGTH_MS, allSignIds } from './clips'
import type { PlaybackTimeline, SelectedPhrase } from './types'

/** Words that carry no separate sign in the catalog and are dropped, not spelled.
 *  Spelling "the" letter by letter is worse than omitting it: ASL has no article
 *  and the spelling implies a lexical item that is not there. */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'of', 'to', 'and', 'that', 'this', 'it', 'its', "it's",
])

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Catalog ids that a single English word maps to, longest phrase first. */
function catalogIndex(): Map<string, string> {
  const index = new Map<string, string>()
  for (const id of allSignIds()) index.set(id.replace(/_/g, ' '), id)
  return index
}

export type OfflinePlan = {
  timeline: PlaybackTimeline
  gloss: string[]
  spelled: number
  matched: number
}

/**
 * Build a playable timeline from arbitrary text using only local data.
 * Returns null when there is nothing renderable at all.
 */
export function offlinePlan(text: string): OfflinePlan | null {
  const words = norm(text).split(' ').filter(Boolean)
  if (!words.length) return null
  const index = catalogIndex()

  const gloss: string[] = []
  const clips: PlaybackTimeline['clips'] = []
  let offset = 0
  let matched = 0
  let spelled = 0

  for (let i = 0; i < words.length; i++) {
    // Prefer the longest registered multi-word expression starting here, the
    // same precedence the backend fallback uses.
    let id: string | undefined
    let span = 1
    for (let length = Math.min(3, words.length - i); length >= 1; length--) {
      const phrase = words.slice(i, i + length).join(' ')
      const hit = index.get(phrase)
      if (hit) { id = hit; span = length; break }
    }

    if (id) {
      const duration = CONTINUOUS_LENGTH_MS[id] ?? 900
      clips.push({
        anchor: `a${clips.length + 1}`, sign_id: id.toUpperCase(), clip_id: id,
        start_ms: offset, end_ms: offset + duration, realization: 'offline-catalog',
      })
      gloss.push(id.toUpperCase())
      offset += duration
      matched += 1
      i += span - 1
      continue
    }

    const word = words[i]
    if (FUNCTION_WORDS.has(word)) continue
    const letters = word.replace(/[^a-z0-9]/g, '')
    if (!letters) continue
    // 360 ms per letter, matching the backend and the renderer's own
    // fingerspelling cadence in ./clips.
    const duration = Math.max(700, letters.length * 360)
    clips.push({
      anchor: `a${clips.length + 1}`, sign_id: `FS:${letters.toUpperCase()}`,
      clip_id: `fs:${letters}`, start_ms: offset, end_ms: offset + duration,
      realization: 'fingerspelling-approximation',
    })
    gloss.push(`FS:${letters.toUpperCase()}`)
    offset += duration
    spelled += 1
  }

  if (!clips.length) return null
  return {
    timeline: {
      version: 2, renderer: 'sign-procedural-v2', duration_ms: offset,
      clips, nonmanuals: [],
    },
    gloss, spelled, matched,
  }
}

/** Wrap an offline plan as the queue item `Live` plays. */
export function offlineSelection(text: string, id: number): SelectedPhrase[] {
  const plan = offlinePlan(text)
  if (!plan) return []
  return [{
    phrase_id: `offline-${id}`,
    label: text,
    matched_text: text,
    validation_status: 'illustrative',
    animation_file: null,
    playback: plan.timeline,
    gloss: plan.gloss,
    match_confidence: 0,
    match_threshold: 0,
    match_kind: 'fallback',
    match_reason: plan.spelled
      ? `Planner unavailable. Rendered offline: ${plan.matched} catalog sign(s), `
        + `${plan.spelled} fingerspelled. Not a translation.`
      : 'Planner unavailable. Rendered offline from catalog signs. Not a translation.',
    rendering_source: 'fingerspelling-fallback',
  }]
}

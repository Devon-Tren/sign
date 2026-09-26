# Hybrid motion authoring and inspection

Branch: `feature/avatar-motion-upgrade`. All bundled motion is experimental.
An application-authored "curated" prototype is **not** Deaf/ASL expert validation.
Linguistic review of the exact rendered utterance is required before claiming
accurate ASL interpretation.

## Architecture

Before: English → existing linguistic planner → timed sign IDs → procedural
phonology-to-pose generation → IK and Rocketbox rig.

Now: English → the same linguistic plan and anchored nonmanual spans → motion
resolver → exact curated phrase / curated sign / procedural / fingerspelling →
resolved timeline → transition-aware sampler → existing IK and Rocketbox rig.

The planner still restricts model output to registered IDs and `FS:WORD`.
`backend/playback.py` resolves authored durations and preserves lexical anchors.
`frontend/src/motion/resolver.ts` resolves both backend and offline timelines,
remapping nonmanual timing at sign boundaries. `frontend/src/playback.ts` samples
the resolved timeline. Learn and Library use the same individual-sign resolver.
No microphone or transcription implementation was replaced.

The wire format remains version 2 with the legacy `sign-procedural-v2` renderer
identifier for compatibility. `source` on clips and `curated_phrase` on the timeline
are additive fields; `realization` continues to identify the underlying descriptor
format. Existing clients should be upgraded alongside this branch to see overrides.

Resolution priority:

1. Exact **whole planned sign sequence** in `phrases`.
2. Individual sign in `signs`.
3. Existing ASL-LEX/custom procedural descriptors.
4. Supported alphanumeric fingerspelling.

Phrase matching never matches English substrings, reorders a linguistic plan, or
silently swallows names. Missing phrase definitions fall through to individual
signs. No wildcard phrase or partial-phrase replacement is implemented.

## Bundled overrides

| Scope | IDs | Status |
| --- | --- | --- |
| Individual sign | `HELLO`, `THANK_YOU` | Experimental authored keyframes using existing body anchors |
| Whole phrase | `greeting_thanks_prototype`: `HELLO`, `THANK_YOU` | Experimental continuous trajectory, custom sign boundaries, phrase-wide nonmanual span |
| All other catalog signs | Existing 1,285-entry descriptor vocabulary, except the two overridden IDs | Procedural |
| Unknown content | `FS:WORD` | Approximate fingerspelling |

The larger requested vocabulary (YES, NO, PLEASE, SORRY, NAME, WHAT, YOUR, MY,
HELP, UNDERSTAND, GOOD, BAD, SCHOOL, CLASS, TEACHER, STUDENT, LEARN) has not been
represented as newly validated motion. Use the planner's existing registered IDs;
for example, pronoun choices may use `ME`/`YOU` rather than assumed `MY`/`YOUR` IDs.

## Open the inspector

Click **Inspect motion** on a playing Classroom, Learn, or Library avatar. To open
it automatically use `http://localhost:5173/?debugMotion=true`, then open Translate
or Learn. The idle home preview intentionally has no inspector panel.

Controls: pause/play, previous/next lexical sign, ±1 frame (1/30 second), replay,
time scrubber, 0.25×/0.5×/1×, and front/side/hand-focused camera presets. The inspector
owns playback speed and pause while open. Closing it returns control to the host
page. Classroom completion is held while inspecting so the queue does not remove
the utterance mid-debug. Close the inspector to continue the live queue.

The inspector samples the actual avatar clock at 10 Hz. Expand diagnostics for
transcript, plan, neighbors, source, current phase, parameters, both hand targets,
palm and finger directions, requested wrist quaternion, actual rig wrist quaternion,
actual hand world position, joints, contact, relationship, nonmanual spans and
missing rig morphs. Target coordinates are normalized body coordinates; actual
measurements are world coordinates and must not be directly subtracted.

A diagnostic phase reflects the sampled procedural morpheme (or authored phase)
and is replaced by `transition` during coarticulation. Handshape/location fields
show descriptor input; the resolved joints and positions below them show overrides.

## Add an individual curated sign

Edit `data/asl_curated_motions.json`, under `signs`, keyed by the registered uppercase
sign ID. Use an existing procedural `base_clip` as the fallback for unspecified
channels. Copy HELLO to start, then replace its actual trajectory and provenance.

```json
{
  "duration_ms": 1200,
  "status": "experimental",
  "provenance": "Who authored this and what reference it uses; review pending",
  "base_clip": "hello",
  "phases": [0.18, 0.62, 0.82],
  "keyframes": [
    {"t": 0, "right": {"target": [0.355, -0.811, 0.345], "shape": "flat_b"}},
    {"t": 0.5, "right": {"target": [0.12, 0.4, 0.3], "palm": [0, 0, 1], "point": [0, 1, 0], "shape": "flat_b", "contact": true}},
    {"t": 1, "right": {"target": [0.355, -0.811, 0.345], "shape": "flat_b"}}
  ]
}
```

This is a format example, not an ASL correctness claim. Times must be strictly
increasing, begin at 0, and end at 1. Phase values are the normalized ends of
preparation, stroke and hold. Transition ends at 1. Each `right`/`left` key supports:

- `target`: position, origin between shoulders, one arm reach per unit, +x dominant
  side, +y up, +z forward. The existing renderer handles the Rocketbox x-axis flip.
- `palm`, `point`: palm normal and finger direction. These define a coherent wrist
  basis; quaternion slerp interpolates it. There is no competing Euler state.
- `shape`: existing handshape name, or `hand`: explicit finger/thumb joint values.
- `elbow`: bend-plane hint, `wristMax`: rig wrist allowance, `contact`: target contact.
- Top-level head, torso and facial controls described below.

Unspecified channels sample `base_clip` at that keyframe's time; they do **not**
inherit the previous keyframe's values. Author every important channel at every
key if it must remain fixed. Parsed keyframe poses are cached. Positions and
joint values use smoothstep interpolation; wrists use quaternion slerp. Contact
switches at the midpoint between keys, so put adjacent keys close to an intended
contact event when precise switching matters.

Restart the backend after JSON changes (the descriptor loader is cached); Vite
reloads frontend imports. Run the checks below and inspect front/side/close-up
views, including transitions to several neighboring signs.

## Add a phrase

Under `phrases`, use an arbitrary unique motion ID. It uses the same keyframes,
plus `sequence` and `boundaries`:

```json
{
  "sequence": ["HELLO", "THANK_YOU"],
  "boundaries": [0, 0.46, 1],
  "duration_ms": 2300,
  "nonmanuals": [{"start": 0, "end": 1, "controls": {"mouth": 0.05, "bodyShift": 0.02}}]
}
```

Also supply `status`, `provenance`, `base_clip`, `phases`, and full `keyframes` as
shown in the bundled phrase. There must be N+1 boundaries for N registered sign
IDs. Keyframes span the entire phrase; lexical boundaries do not restart the
motion or invoke automatic sign blending. Existing anchored planner spans are
retimed to those boundaries. Authored spans apply first; explicit planner controls
overlay those channels. Names must be explicit `FS:NAME` tokens in an exact
sequence if authoring a fixed named phrase; an ellipsis is not a wildcard.

This structure can represent WHAT YOUR NAME, NICE MEET YOU, I DON'T UNDERSTAND,
CAN YOU HELP ME, and other sequences **when they match registered planner IDs**.
It does not invent their grammar or supply missing phrase animations.

## Procedural extension points

`data/asl_custom_motions.json` → `augment[clip_id]` accepts optional:

```json
{
  "phases": [0.18, 0.62, 0.82],
  "primitive": {"type": "arc", "direction": [0, 0, 1], "distance": 0.12, "amplitude": 0.05, "repetitions": 1, "speed": 1, "easing": "smooth"},
  "relationship": {"type": "dominant_support", "dominant": "right"}
}
```

Primitives: linear, arc, semicircle, circle, ellipse, zigzag, bounce, tap, brush,
twist, approach-contact, contact-release. They support origin, direction, distance,
amplitude, curvature, repetition, phase-speed and easing. Primitive speed changes
cycles inside the sign, not utterance playback speed. Existing circular and
back-and-forth descriptors now use these reusable primitives; remaining legacy
mappings retain their earlier paths until individually reviewed.

Relationships: mirrored, parallel, alternating (`phaseOffset`), dominant_support,
approaching, separating, contact (`contactAt`, `offset`). Existing hand-surface
relations remain the default. Alternating procedural paths sample the second hand
at the offset phase. In authored clips, write alternating keyframes explicitly.
No physical hand-to-hand collision solver is implied.

## Transitions and phases

Procedural onset/release timing retains the previous default of up to 170/200 ms;
strokes occupy 62% of each morpheme's core with a 520 ms cap. Overrides can change
phase ends. Isolated and connected timing schedules remain distinct.

Between individual signs, transition duration depends on hand-target distance,
contact, an active/rest hand change, available sign length and playback speed. It
is bounded to 100–360 timeline ms and at most 42% of the outgoing sign. Cubic
Hermite position interpolation uses neighboring motion samples for tangents;
tangents are bounded to reduce overshoot. Orientation uses a coherent quaternion
basis. The incoming stroke is retimed from the transition endpoint, avoiding a
neutral dip or frozen onset. Whole authored phrases bypass automatic coarticulation.
This is a heuristic, not captured human coarticulation or full velocity continuity.

## Nonmanual spans

Existing profiles with `brow`, `mouth`, `head`, `torso` remain compatible. Profiles,
authored keys/spans and procedural augmentations can additionally carry
`browRaise`, `browFurrow`, `headShake`, `headNod`, `eyeAperture`, `gaze`, `mouthShape`,
`cheek`, `torsoLean`, and `bodyShift`. Head tilt uses `head[2]`. Gaze x/y drive the
current rig; its third component is reserved. All controls are bounded to [-1,1].

Backend spans still use start/end sign anchors. Overlapping spans may combine
independent channels; competing channels are rejected. Span entry/exit ramps are
up to 120 ms. `mouthShape` currently controls lip pucker and `cheek` cheek raise;
they are extension channels, not a complete ASL mouth-morpheme system. Extra morphs
are driven only where the loaded rig exposes them; requested unavailable controls
are listed in the inspector. Body shift is currently a spine lean, not root motion.

## Checks and limitations

```sh
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend run audit
cd backend && .venv/bin/python -m pytest -q
```

Tests cover resolution precedence, exact phrase lookup, offline spelling, authored
endpoints, spans, invalid data, source timing, phase/primitive/relationship helpers,
quaternion orthogonality, mixed-sequence boundary continuity, and finite samples
across the full procedural vocabulary. Backend policy tests retain reviewed-only
gating. Renderer fingerprints now include authored data, motion modules, anchors,
handshapes and rig implementation.

Remaining gaps: no captured trajectories, no signer-approved clips, approximate
finger spelling and English-to-ASL construction, no full collision/contact solver,
limited facial channels, heuristic transitions, no variable-name phrase templates.
The inspector exposes these limitations rather than granting linguistic approval.

## File inventory

Created:

- `data/asl_curated_motions.json`
- `backend/curated_motion.py`
- `backend/tests/test_curated_motion.py`
- `frontend/src/components/MotionInspector.tsx`
- `frontend/src/motion/types.ts`
- `frontend/src/motion/resolver.ts`
- `frontend/src/motion/curated.ts`
- `frontend/src/motion/phases.ts`
- `frontend/src/motion/orientation.ts`
- `frontend/src/motion/primitives.ts`
- `frontend/src/motion/relationships.ts`
- `frontend/src/motion/nonmanuals.ts`
- `frontend/src/motion/transitions.ts`
- `frontend/tests/motion.test.ts`
- `docs/HYBRID_MOTION_AUTHORING.md`

Modified: `backend/playback.py`; `frontend/src/clips.ts`, `playback.ts`, `types.ts`,
`styles.css`, `components/Avatar.tsx`, `components/Live.tsx`; frontend `package.json`
and lockfile; `data/asl_custom_motions.json` (extension schema descriptions);
`README.md`, `docs/REPO_STATUS.md`, `docs/AVATAR_MOTION_PIPELINE.md`.

`anchors.ts`, `handshapes.ts`, `signerRig.ts`, `backend/planner.py` and the ASL-LEX
extract are reused through their existing interfaces. No new skeletal assets or
motion-capture infrastructure are required. Node type declarations were added for
the existing audit CLI and Node-based motion regression tests.

# Live signing and avatar motion pipeline

> The `feature/avatar-motion-upgrade` branch adds a hybrid resolver, authored
> phrase/sign prototypes, transition-aware sampling, and a live motion inspector.
> See [Hybrid Motion Authoring](HYBRID_MOTION_AUTHORING.md) for the current runtime
> contract and authoring instructions. The procedural background below remains
> relevant; its historical catalog counts predate the 1,285-entry expansion.

Last reviewed: September 26, 2026

## The system is four separate problems

SIGN should not train one opaque model to "listen and animate." The maintainable
pipeline is:

1. **Speech recognition** produces revisable partial captions and ordered final
   turns.
2. **Meaning and catalog retrieval** maps a final turn to registered sign IDs,
   preserving recent context and falling back visibly when coverage is missing.
3. **Motion retrieval and sequencing** selects only registered assets and adds
   transition timing, nonmanual markers, and review metadata.
4. **Rendering** retargets and blends skeletal clips on one calibrated avatar.

This separation keeps a transcription correction from becoming an invented
joint trajectory and lets each layer be evaluated independently.

## Current repository state

- SQLite exposes 104 searchable illustrative phrase/sign rows.
- The planning catalog contains 103 playable procedural motion entries and 74
  candidate sentence examples.
- **97 motion entries are parameterised from ASL-LEX 2.0 phonological
  descriptors** (78 exact lemma matches, 19 documented approximate mappings).
  Six entries remain application-authored because no plausible ASL-LEX lemma
  exists: `compile`, `do`, `explain`, `five`, `part`, `refill`.
- Six entries carry the full ASL-LEX morpheme sequence rather than a single
  descriptor block, so a compound such as `LEARN` (gather from the palm, then to
  the forehead) plays as two articulations instead of holding the first.
- No construction or motion has an approved signer-review record.
- Unknown concepts remain visibly labelled fingerspelling approximations.

### Descriptor coverage

`scripts/extract_asl_lex.py` maps catalog ids onto ASL-LEX entries. It previously
extracted 11; every id with a plausible lemma is now mapped, and the ids without
one stay in `data/asl_custom_motions.json` flagged `app_authored` so the gap is
reported rather than hidden.

`data/asl_custom_motions.json` is now two blocks. `signs` holds phonology for
the six unmapped ids. `augment` layers app-authored values on top of licensed
descriptors and never replaces a phonological value: non-manual grammar,
repetition counts, movement size and axis, and the two-handed relations that a
contact-surface name cannot express.

`backend/motion_data.py` is the single loader for both files. `catalog_store` and
`playback` each previously read only the custom file, so a sign described by the
licensed extract was invisible to the planner unless it had also been
hand-authored.

### Handshapes

Handshape composition moved to `frontend/src/handshapes.ts`. ASL-LEX names
handshapes compositionally (`flat_b`, `curved_5`, `flatspread_5`) and codes
Flexion, Spread, ThumbPosition, ThumbContact and SelectedFingers as separate
orthogonal columns; the previous 24-entry lookup table had nowhere to put them,
so all five columns were extracted and never read. A base form plus modifiers,
refined by those columns, now covers **all 58 handshapes ASL-LEX uses**.

This fixed three shipped collisions: `closed_b`, `flat_b` and `b` resolved to
byte-identical poses, as did `s` and `fist`, and `m`/`n`/`t` were separated only
by a thumb role that did not distinguish how many fingers cover the thumb.

`UlnarRotation` and `Contact` are also read now. Contact matters most: roughly
1,694 of 2,723 ASL-LEX entries are coded `Contact=1`, and the renderer's torso
clearance field was pushing every one of them off the body it is supposed to
reach.

### Fingerspelling

The manual alphabet resolved 26 letters onto 13 distinct poses — `D`, `G`, `L`,
`Q` and `Z` were all the `1` handshape — on the code path that renders every
unsupported word. Each letter now carries its own handshape plus the palm and
pointing direction that separates it, and `npm --prefix frontend run audit`
fails if any two letters become indistinguishable again.

### Timing

Two schedules, because the published corpora give two different answers.
SignAvatars' isolated subsets run ~57 and ~60 frames at 24 fps (about 2.4-2.5 s
per sign), while its continuous Language2Motion subset runs ~162 frames at 24 fps
for a multi-sign sequence — roughly 1.0-1.35 s per sign, close to citation form.
Isolated display stretches citation duration ~2.1x (1250-2500 ms); connected
signing stretches it ~1.15x (700-1400 ms). One global stretch made the live
avatar wade through a lecture.

Legibility is bought by extending the **hold**, not by slowing the stroke.

Onset and release are fixed milliseconds (170 / 200), not fractions of clip
duration. Human sign transitions run roughly 150-250 ms whatever the sign's
length; the previous fractional release spent nearly 400 ms drifting to neutral
on a long clip.

### Non-manual grammar

`Pose` gained a `headShake` channel. Negation in ASL is marked on the head, so
`NO` and `NOT` were previously missing their grammar however correct the hands
were. WH-questions furrow the brow and yes/no questions raise it; the two drive
opposing action units and are never both asserted.

### Two-handed relations

The contact surface is in the licensed data — for a sign coded
`MajorLocation=Hand`, `MinorLocation` names `Palm`, `PalmBack`, `Heel`,
`FingerRadial`, `FingerTip` and so on. `frontend/src/anchors.ts` turns each
surface into a relation, replacing the per-sign `id === 'help'` offsets that were
compiled into the renderer. `DominanceViolation` and `SymmetryViolation` are also
handled; the previous `startsWith('Asymmetrical')` test missed them, so `NAME`,
`LAST`, `OR` and `RUN` all rendered one-handed.

All 37 ASL-LEX minor locations now have anchors. The previous table carried 18,
several of them app-invented rather than ASL-LEX vocabulary, so a sign coded at
`FingerRadial` or `Clavicle` or `TorsoTop` was rendered in neutral space.

### Audit

The catalog had no way to be inspected as a whole, which is why the collisions
above shipped. Two halves now exist:

- `npm --prefix frontend run audit` — numeric. Pose distinctness, vocabulary
  coverage and provenance, exiting non-zero on any collision.
- The **Motion audit** tab — visual. Renders all 103 motions on the real rig at
  their hold frame and captures a contact sheet, with provenance badges.

`backend/tests/test_motion_data.py` asserts the data-side invariants: the two
descriptor files stay disjoint, every handshape resolves to a base form, every
location has an anchor, every hand-located sign resolves to a relation, and the
augment entries that carry several fields keep all of them.

### Rendering

- The default camera is a three-quarter view, not frontal. ASL uses movement
  toward and away from the body and a dead-on camera flattens that axis.
- The shadow frustum was tightened from 6x6 units to the figure. The mesh already
  casts and receives, so the hands shadow the torso — the strongest available
  cue for how far a hand sits from the chest — and it was being spent on empty
  space.

Those changes prevent many impossible poses and make the licensed data
load-bearing, but a descriptor such as "curved movement near the head" is still
not a recorded human performance. **Nothing here makes the output validated
ASL.** The next quality tier is captured motion; see the path below.

## Live path

`gpt-live-transcribe` receives 24 kHz PCM through the backend WebSocket. The
backend uses client-side energy detection and commits a turn after 0.75 seconds
of silence by default. It sends the transcription service a bounded list of
catalog vocabulary hints. The frontend displays deltas immediately; final turns
run deterministic catalog matching and fast motion planning concurrently, then
enter a bounded playback queue so the avatar cannot fall indefinitely behind a
speaker.

Relevant configuration:

```dotenv
OPENAI_TRANSCRIBE_MODEL=gpt-live-transcribe
SIGN_TRANSCRIPTION_DELAY=low
SIGN_SILENCE_SECONDS=0.75
SIGN_MAX_TURN_SECONDS=6
SIGN_TRANSCRIPTION_PROMPT=A classroom lecture with accessibility captions.
SIGN_TRANSCRIPTION_KEYWORDS=course-specific term|another literal term
```

The [official OpenAI Realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
documents incremental delta/completion events, manual audio-buffer commits for
`gpt-live-transcribe`, vocabulary hints, and the need to reconcile turns by
`item_id`. Real classroom tests must still measure latency, corrections, empty
turns, accents, noise, and long-session behavior.

## Path to captured motion

The best next renderer is hybrid:

- Use reviewed skeletal animation clips for supported signs and phrases.
- Retain the procedural renderer only as a clearly labelled fallback.
- Retain English captions whenever retrieval or review is uncertain.

[3D-LEX v1.0](https://arxiv.org/abs/2409.01901) describes 1,000 captured ASL
signs plus 1,000 NGT signs using body motion capture, instrumented hand capture,
and facial capture. Its paper reports a CC BY 4.0 dataset and makes it a strong
candidate source, but no files are bundled here. Access, exact export formats,
signer consent terms, and retargeting quality must be confirmed before import.

[PopSign ASL](https://signdata.cc.gatech.edu/view/) is a useful official source
of isolated ASL videos for evaluation or a pose-reconstruction research path.
Video is not a drop-in skeletal animation asset: converting it to 3D introduces
depth, hand-occlusion, and facial-motion estimation error and still requires
review.

When skeletal clips are available, import them through Blender, map source bones
to the Rocketbox rig, correct hand axes and skin weights, and export glTF/GLB
clips. Three.js supports skeletal keyframe clips through `AnimationMixer`; its
official [`AnimationAction`](https://threejs.org/docs/pages/AnimationAction.html)
API provides one-shot playback, time scaling, and crossfades.

Each production motion record should include:

```json
{
  "sign_id": "HELP",
  "format": "gltf-skeletal-v1",
  "uri": "/motions/help.glb",
  "clip": "HELP",
  "duration_ms": 920,
  "source": "licensed dataset or authored capture",
  "license": "verified identifier",
  "skeleton": "rocketbox-f014-v1",
  "dominant_hand": "right",
  "review_status": "candidate",
  "review_fingerprint": null
}
```

## Quality gates before a clip teaches anyone

1. Retarget without changing wrist, MCP, PIP, DIP, elbow, or shoulder joint
   limits.
2. Inspect front, side, and hand-close-up views for mesh penetration, flipped
   axes, foot sliding, and camera cropping.
3. Test transitions from neutral and from at least four different neighbouring
   signs; an isolated clip can look correct and still blend badly.
4. Compare location, handshape, movement, palm orientation, facial grammar, and
   timing against the source performance.
5. Obtain review from qualified Deaf ASL signers and record back-translation
   evidence through the existing fingerprinted review workflow.
6. Enable the learning item only after the exact rendered asset is approved.

Training a text-to-motion network is a later research phase, not the next MVP
step. It requires a licensed, retargeted, signer-reviewed corpus with continuous
coarticulation and held-out evaluation. Until that exists, retrieval of reviewed
clips is safer, faster, easier to debug, and more appropriate for instruction.

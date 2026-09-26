# Repository Status

> **Maintenance rule:** Update this file as part of every push that changes the repository's behavior, architecture, dependencies, setup, tests, or known limitations.

Last updated: September 26, 2026

Branch: `feature/avatar-motion-upgrade`

Push record: implementation commit `2336a3e` was pushed to
`origin/feature/avatar-motion-upgrade` on September 26, 2026. The branch is not
merged into `main`. This documentation follow-up records the completed push;
the verification results below apply to that implementation.

Project stage: Hackathon research prototype

## Current Summary

SIGN is a React and FastAPI prototype that combines live English captions, experimental avatar motion planning, an illustrative phrase library, and camera-based handshape practice. The application is designed for accessibility research and ASL learning exploration.

The project is runnable locally with `bash start.sh`:

- Frontend: `http://localhost:5173`
- Backend API documentation: `http://localhost:8000/docs`

The bundled gestures and generated motion sequences are **not validated ASL** and must not be presented as professional interpretation.

## Hybrid Motion Upgrade (September 26, 2026)

The avatar now resolves **exact curated phrase → curated sign → procedural
ASL-LEX/custom motion → fingerspelling**. English planning, registered IDs,
transcription paths, catalog matching, Learn exercises, and rig controls remain.
Two experimental authored sign overrides (`HELLO`, `THANK_YOU`) and one complete
`HELLO THANK_YOU` trajectory demonstrate the new format. All other registered
motions retain procedural fallback. No motion is signer-approved.

Click **Inspect motion** on an active avatar or open `?debugMotion=true`. The
inspector uses the avatar clock and exposes the transcript, lexical boundaries,
source, phonology, phases, targets, orientation, actual rig measurements and facial
spans. It provides pause, sign navigation, frame stepping, replay, slow motion,
and camera presets. Classroom playback waits while inspecting.

New motion modules separate authored sampling, resolution, quaternion orientation,
movement primitives, phase timing, hand relationships, nonmanual controls, and
transition calculation. Transitions consider hand distance, activity, contact and
speed, with bounded Hermite tangents; authored full phrases bypass those blends.
Backend nonmanual spans retain sign anchors and support additional independent
facial/body channels. Review fingerprints include the new motion system.

See [Hybrid Motion Authoring](HYBRID_MOTION_AUTHORING.md) for the architecture,
new file inventory, source precedence, sign and phrase authoring instructions,
coordinate conventions, timing, and limitations. Generated motion and curated
prototype motion remain experimental; linguistic review is required before
claiming accurate ASL interpretation.

## Implemented Features

### Home and Navigation

- Standalone product home screen.
- Classroom, Learning Studio, Phrase Library, and Settings views.
- Responsive sidebar and mobile layouts.

### Audio to Text

- Start and stop microphone controls in the Classroom.
- Partial captions appear while the user is speaking.
- Final captions enter the transcript and experimental avatar-planning queue.
- OpenAI realtime transcription through the FastAPI WebSocket when `OPENAI_API_KEY` is configured.
- Automatic browser Speech Recognition fallback when the backend transcription connection is unavailable.
- Continuous browser transcription restarts after quiet periods.
- Clear errors for denied permission, missing microphones, unsupported browsers, and network failures.
- Transcript turns are retained in memory for context during the session.
- Audio is processed as a stream; the application does not intentionally store microphone recordings.

Browser fallback is expected to work best in current Chrome and Edge releases. It may use the browser vendor's online speech service and therefore still requires network access.

### Classroom and Avatar

- Typed text and finalized microphone speech produce captions.
- Catalog matching and deterministic motion planning run concurrently to reduce
  time from a final transcript to avatar playback.
- The live playback queue is bounded so the avatar cannot fall indefinitely
  behind a lecture.
- Structured experimental gloss planning is exposed through `POST /api/plan`.
- Known candidate motions and fingerspelling fallbacks compile into a shared playback timeline.
- Realtime transcription receives catalog-derived vocabulary hints and uses
  configurable client-side silence segmentation.
- The current Classroom displays the partial or latest transcript over the avatar; it does not currently render the earlier transcript-history panel, transcript export, or sample-lecture control.
- Candidate motion sequences remain visibly labelled as experimental.
- Unsupported or failed translations retain their English captions.
- The avatar uses bounded finger/thumb/wrist motion, acceleration-damped arm
  targets, angular-velocity limits, a torso-clearance field, complete
  onset/hold/release timing, and continuous cross-sign coarticulation.
- Procedural poses now include location/sign-specific elbow planes and
  conservative clavicle participation so raised hands do not leave the shoulder
  girdle frozen in a mannequin pose.
- The renderer calibrates finger flexion independently for each mirrored hand,
  fixing the rig-axis mismatch that made one hand curl away from its own palm.
- Forearm pronation and wrist swing are composed in skeleton hierarchy order;
  this fixes outward/inward pointing targets that previously remained upright.
- Palm, pointing, and elbow directions use spherical interpolation, preventing
  opposite orientation vectors from collapsing and flipping the wrist during a
  transition.
- Core motion candidates use tighter B-family handshapes, smaller path scales,
  raised passive-hand rest positions, and focused overrides for `HELLO`,
  `THANK_YOU`, `YES`, `NO`, `PLEASE`, `NAME`, `ME`, `YOU`, `HELP`, `AGAIN`,
  `UNDERSTAND`, and `BATHROOM`.

### Learning Studio

- A guided curriculum with Foundations, Greetings, Introductions, and Classroom Basics.
- Four preserved foundation exercises plus ten sign-oriented learning items.
- Reference-avatar replay, pause, speed, manual rotation, and concise handshape/position/movement/orientation teaching notes.
- Guided practice states: ready, countdown, tracking, feedback, and completed.
- Webcam input and visible landmarks using the existing MediaPipe Hand Landmarker.
- MediaPipe's WebAssembly runtime and official hand-landmarker model are bundled under `frontend/public/mediapipe`, so practice startup does not depend on jsDelivr or Google model-host availability.
- Per-finger measured results, specific corrections, retry history, and continue-to-next-item flow.
- Completion still requires 12 stable frames at the existing handshape threshold and persists under the existing browser `localStorage` key.
- Real handshape practice is enabled for Open hand, Closed hand, Index extension, Two-hand coordination, Hello, Thank you, Please, Me, You, Understand, and Question.
- Name, Help, and Again are demonstration-only because the current analyzer cannot score their mixed handshapes, movement, position, or orientation.
- This feature assesses finger shape only and does not validate complete signs or ASL fluency.

### Phrase Library and Review

- Searchable phrase catalog with provenance and validation metadata.
- SQLite now indexes all 1,285 playable procedural motions, producing 1,286
  searchable rows after overlap with the original phrase seed.
- `GET /api/health` verifies that SQLite animation keys and planner motion IDs
  remain a complete two-way match; the Classroom displays `SQL linked` when the
  integrity check passes.
- The runtime planning catalog contains 1,285 motion entries and 74 candidate
  sentence examples.
- SQLite catalog by default, with optional MongoDB support.
- 1,279 of the 1,285 motions are parameterised from ASL-LEX 2.0 phonological
  descriptors. `scripts/extract_asl_lex.py` maps the curated catalog ids by hand
  and then auto-expands to every clean lemma rated at or above 4.0 on ASL-LEX's
  own `SignFrequency(M)` scale, excluding English function words that ASL does
  not lexicalise. Nineteen are documented approximate mappings; six entries are
  application-authored because no plausible lemma exists, and are flagged
  `app_authored` so the UI and the audit report say so.
- 119 entries carry a full ASL-LEX morpheme sequence, so a compound such as
  `LEARN` plays as two articulations rather than holding the first.
- Handshapes are composed from a base form plus modifiers and refined by the
  ASL-LEX Flexion, Spread, ThumbPosition, ThumbContact and SelectedFingers
  columns, covering all 58 handshapes the database uses. `Contact` and
  `UlnarRotation` are also read. All 37 minor locations have anchors.
- Two-handed contact relations are derived from the licensed contact surface
  rather than authored per sign.
- Isolated display and connected signing use separate tempo schedules; onset and
  release are fixed-millisecond rather than proportional to clip length.
- Non-manual grammar includes a head-shake channel for negation, and the
  WH-furrow and yes/no-raise markers are never both asserted.
- Review packets can be exported with `scripts/export_asl_review.py`.
- Review-gated playback support exists, but no approved constructions are bundled.
- Reviewer workflow and playback contract are documented in [ASL_PLAYBACK_AND_REVIEW.md](ASL_PLAYBACK_AND_REVIEW.md).
- Rendering research, the captured-motion migration contract, and quality gates
  are documented in [AVATAR_MOTION_PIPELINE.md](AVATAR_MOTION_PIPELINE.md).

### Motion Audit

- A **Motion audit** view renders the procedural catalog motions on the real rig at their hold
  frame and captures a contact sheet with provenance badges. The catalog could
  previously only be inspected one sign at a time, which is how two defects
  shipped unnoticed: three distinct handshapes resolved to identical poses, and
  19 of the 26 fingerspelled letters shared a shape with another letter.
- `npm --prefix frontend run audit` is the numeric half. It reports pose
  distinctness, vocabulary coverage and provenance, and exits non-zero if any two
  handshapes or letters become indistinguishable.
- `backend/tests/test_motion_data.py` asserts the data-side invariants, including
  that every handshape resolves to a base form and every location has an anchor.
  A descriptor value with no renderer entry does not crash, it silently degrades,
  so these are checked rather than observed.

### Offline and Degraded Operation

- `POST /api/plan` is what lets the avatar sign anything outside the catalog.
  When it is unreachable, `frontend/src/offlinePlan.ts` reproduces the fallback
  locally: it matches registered signs word by word, drops function words and
  fingerspells the remainder. Previously an unreachable planner produced an
  empty selection and the avatar simply stood still with nothing in the UI
  explaining why.
- The Classroom shows an explicit notice while the planner is unreachable,
  rather than silently reducing coverage.

### Avatar Rendering

- Finger flexion and abduction directions are MEASURED on the loaded skeleton
  rather than derived from the palm normal. The Biped hands are mirrored, and a
  derived sign depends on three conventions agreeing at once; when one was
  inverted the non-negative flexion clamp drove the joints into extension and
  the fingers hyperextended into a claw. Flexion is now identified as the
  rotation that brings the fingertip closer to the wrist, which holds on either
  hand whatever the local bone axes are.
- `applyFinger` enforces anatomical joint coupling: the DIP is tendon-coupled to
  the PIP and cannot lead it. No pose data, authored or later imported from
  capture, can put the hand outside human range.
- The neutral stance hangs the arms at roughly 35 degrees of elbow flexion. The
  previous rest held them at about 74 degrees, which read as a person waiting
  with their hands up rather than standing at ease.
- The default camera is a three-quarter view and the shadow frustum is fitted to
  the figure, so the hands' self-shadow on the torso reads as contact.

### ASL to English Recognition

- A closed-domain hackathon MVP is designed in [ASL_TO_ENGLISH_MVP.md](ASL_TO_ENGLISH_MVP.md).
- Evaluation cases and a schema test are present for the planned recognition pipeline.
- Runtime ASL-to-English recognition is **not implemented**. The current Tutor compares a selected handshape target and cannot identify an unknown sign or translate a signed sentence.

## Technology

| Area | Current implementation |
| --- | --- |
| Frontend | React 18, TypeScript, Vite |
| 3D | Three.js, React Three Fiber, React Three Drei |
| Backend | FastAPI, Python |
| Realtime audio | Web Audio API, AudioWorklet, WebSocket, OpenAI realtime transcription |
| Browser fallback | Web Speech Recognition API |
| Computer vision | MediaPipe Tasks Vision |
| Storage | SQLite by default; optional MongoDB catalog |
| Tests | Pytest backend suite and TypeScript production build |

## Verification Status

Verified on this branch on September 26, 2026:

- Frontend production build: passed; existing Vite large-chunk warning remains.
- Frontend motion regression suite: **10 passed**.
- Backend test suite: **49 passed**, including six new hybrid-motion tests.
- Numeric audit: 1,285 motions; 58/58 handshapes; zero handshape or letter
  collisions. Its 33 existing issues remain (19 approximate mappings, eight
  relocation/movement inconsistencies, six application-authored descriptors).
- Tests cover exact phrase and sign precedence, fallback spelling, span timing,
  quaternion bases, transitions, primitive/relationship helpers, invalid data,
  and finite poses across the full vocabulary.
- Browser: Learn inspector opened; pause, frame step to 33 ms, 0.25× speed and
  side camera controls worked. Typed `Hello thank you` selected the continuous
  `curated-phrase` motion; previous-sign navigation and stepping worked and the
  Rocketbox avatar rendered. Captured logs showed no application exception;
  an existing MediaPipe informational message was logged at error level.
- The stale local backend was restarted with this branch's code. Browser testing
  against the restarted process and the final inspector layout adjustment could
  not be completed because automatic browser approval review hit its usage
  limit. Automated tests exercise the new backend code directly.
- Git whitespace/conflict-marker checks: passed.

Microphone hardware, browser speech services, and OpenAI realtime transcription
were not exercised end to end during this branch. Existing audio code is unchanged;
backend audio/error-path tests pass. A real microphone session remains a manual
check. No signer/linguistic approval or measured frame-rate benchmark is claimed.

## Configuration

- Keep `OPENAI_API_KEY` in `backend/.env`; never expose it through a `VITE_` variable or commit it.
- `OPENAI_TRANSCRIBE_MODEL` selects the realtime transcription model.
- `SIGN_TRANSCRIPTION_DELAY`, `SIGN_SILENCE_SECONDS`, and
  `SIGN_MAX_TURN_SECONDS` tune live transcription latency and segmentation.
- `SIGN_TRANSCRIPTION_PROMPT` and `SIGN_TRANSCRIPTION_KEYWORDS` add bounded
  literal vocabulary hints without exposing secrets to the frontend.
- `OPENAI_TEXT_MODEL` selects the model used for experimental planning and feedback.
- `SIGN_ALLOWED_ORIGINS` controls accepted local browser origins.
- `SIGN_PLAYBACK_POLICY=reviewed-only` blocks candidate playback until an approved review exists.
- The application can run without an OpenAI key using sample content, deterministic planning fallbacks, and supported-browser speech recognition.

## Known Limitations and Risks

- No bundled animation or generated sequence is currently approved as accurate ASL.
- Browser speech recognition is not supported consistently across all browsers and may depend on a vendor service.
- OpenAI transcription requires a valid key, model access, internet connectivity, and available API quota.
- Speech transcripts may contain errors, especially with names, technical terms, accents, background noise, or overlapping speakers.
- Procedural avatar motion now blends transitions, moves the shoulder girdle,
  and enforces conservative joint/velocity limits, but still lacks captured
  human trajectories, contact constraints, complete facial grammar, and
  signer-reviewed fingerspelling.
- The torso-safe signing plane prevents gross body penetration; it is not a full
  hand/body or two-hand collision solver.
- The Learning Studio tracks limited hand and finger properties rather than complete sign language production.
- The bundled MediaPipe runtime and hand model increase the deployed frontend size, but allow hand tracking to initialize without a first-load CDN request.
- The frontend production bundle currently emits a large-chunk warning during the Vite build.
- Privacy and consent procedures are required before using microphone or camera features in a real classroom.

## Next Priorities

1. Obtain and inspect licensed 3D-LEX skeletal/hand/face exports, then retarget a
   small high-frequency set to the existing avatar.
2. Add glTF skeletal clip playback and `AnimationMixer` crossfades while keeping
   procedural fingerspelling as a labelled fallback.
3. Obtain review from qualified Deaf signers and ASL specialists before enabling
   any learning item as a validated reference.
4. Manually test both microphone paths with representative classroom speech and
   measure transcript-to-motion latency, revisions, and queue age.
5. Add focused frontend tests for transcription state changes; motion resolution,
   coarticulation continuity, and fallback behavior now have regression coverage.
6. Add contact constraints for approved two-hand/body-contact clips and split
   large frontend bundles if load time becomes a demo issue.

## Update Checklist for Future Pushes

Before each push, update the relevant sections above and record the latest checks:

- Current features and behavior.
- Routes, architecture, configuration, and dependency changes.
- Tests and builds run, with their results.
- New limitations, risks, or resolved issues.
- Revised next priorities.

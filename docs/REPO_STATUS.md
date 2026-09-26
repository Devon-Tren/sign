# Repository Status

> **Maintenance rule:** Update this file as part of every push that changes the repository's behavior, architecture, dependencies, setup, tests, or known limitations.

Last updated: September 26, 2026

Branch: `main`

Project stage: Hackathon research prototype

## Current Summary

SIGN is a React and FastAPI prototype that combines live English captions, experimental avatar motion planning, an illustrative phrase library, and camera-based handshape practice. The application is designed for accessibility research and ASL learning exploration.

The project is runnable locally with `bash start.sh`:

- Frontend: `http://localhost:5173`
- Backend API documentation: `http://localhost:8000/docs`

The bundled gestures and generated motion sequences are **not validated ASL** and must not be presented as professional interpretation.

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
  targets, a torso-safe signing plane, complete onset/hold/release timing, and a
  short cross-sign coarticulation blend.

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
- SQLite now indexes all 103 playable procedural motions, producing 104
  searchable rows after overlap with the original phrase seed.
- `GET /api/health` verifies that SQLite animation keys and planner motion IDs
  remain a complete two-way match; the Classroom displays `SQL linked` when the
  integrity check passes.
- The runtime planning catalog contains 103 motion entries and 74 candidate
  sentence examples.
- SQLite catalog by default, with optional MongoDB support.
- Procedural motion data derived partly from ASL-LEX descriptors.
- Review packets can be exported with `scripts/export_asl_review.py`.
- Review-gated playback support exists, but no approved constructions are bundled.
- Reviewer workflow and playback contract are documented in [ASL_PLAYBACK_AND_REVIEW.md](ASL_PLAYBACK_AND_REVIEW.md).
- Rendering research, the captured-motion migration contract, and quality gates
  are documented in [AVATAR_MOTION_PIPELINE.md](AVATAR_MOTION_PIPELINE.md).

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

Verified on September 26, 2026:

- Frontend production build: passed.
- Backend test suite: **30 passed**.
- Frontend development server: returned HTTP `200`.
- Backend API documentation: returned HTTP `200`.
- Browser smoke test: idle, `HELP`, `YES`, and a multi-sign classroom request
  rendered without runtime exceptions; the head and signing space remained in frame.
- Learning Studio webcam startup: manually verified in Chrome; the bundled tracker initialized, the camera entered `LIVE` state, and the `I'm ready` action appeared.
- Git whitespace check: passed.

Live microphone transcription still requires a real browser permission grant and speech input for an end-to-end manual check. Automated tests do not simulate microphone hardware or third-party transcription services.

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
- Procedural avatar motion now blends transitions and enforces conservative
  joint limits, but still lacks captured human trajectories, contact constraints,
  classifiers, complete facial grammar, and signer-reviewed fingerspelling.
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
5. Add focused frontend tests for transcription state changes, timeline
   coarticulation, and fallback behavior.
6. Add contact constraints for approved two-hand/body-contact clips and split
   large frontend bundles if load time becomes a demo issue.

## Update Checklist for Future Pushes

Before each push, update the relevant sections above and record the latest checks:

- Current features and behavior.
- Routes, architecture, configuration, and dependency changes.
- Tests and builds run, with their results.
- New limitations, risks, or resolved issues.
- Revised next priorities.

# ASL video to English: hackathon MVP design

## Decision

The repository does **not** currently recognize ASL or translate signing into English. It contains the reverse path (English text or speech transcript to candidate gloss and avatar playback) plus a webcam handshape drill. The strongest credible hackathon MVP is a **closed-domain, continuous-sign recognizer** for a small, ASL-reviewed classroom vocabulary. It should expose uncertainty and preserve observed meaning rather than promise open-ended ASL translation.

An unrestricted “any phrase” recognizer is not achievable from the current catalog or camera logic. The current runtime catalog has 43 playable sign IDs, 3 expression profiles, and 25 candidate English-to-sign examples, but those assets are unreviewed and are not labeled signer videos for recognition training.

## What the current implementation actually captures

| Path | Current input and processing | Current output | Consequence for ASL-to-English |
| --- | --- | --- | --- |
| Webcam tutor | `Tutor.tsx` requests 640×480 video and runs MediaPipe Hand Landmarker with `numHands: 2` every 95 ms (about 10.5 Hz). | 21 normalized landmarks per detected hand are immediately reduced to four binary values: index, middle, ring, and little finger straight/curled. | Useful only for four static drills. The thumb, handedness result, world landmarks, palm orientation, hand location relative to the body, movement, velocity, holds, face, gaze, head, torso, and frame history are discarded. |
| Tutor feedback | A single-frame match score is accumulated for 12 sampled frames. Optional GPT feedback sees only the observed/expected finger-state text and score. | Coaching sentence for the selected drill. | This is target comparison, not sign recognition. It cannot discover an unknown sign or sentence. |
| Live microphone | `useLiveAudio.ts` streams 24 kHz PCM. `main.py` uses energy thresholds and OpenAI realtime transcription to emit partial and final **spoken-English** text. | English captions. | This audio path contains no signed-language evidence. |
| Planner | `planner.py` accepts English text and recent English context, extracts a `Meaning`, selects catalog sign IDs, and compiles avatar motion. | English-to-candidate-sign playback. | Direction is opposite to this proposal. Its semantic schema and validation ideas can be reused, but its output is not recognition evidence. |
| Phrase matcher | `interpreter.py` retrieves known animations from English aliases. | Known phrase IDs or unsupported. | It recognizes English strings, not video. |

The CSS mirrors the displayed webcam, while detection operates on the underlying video. That is fine for a selfie view, but the recognition pipeline must explicitly store detector handedness and the mirror transform. Otherwise a left-handed signer can silently swap dominant and non-dominant roles.

## Proposed end-to-end pipeline

```text
camera frames
  → quality and framing gate
  → hand + pose + face observations
  → body-relative, handedness-aware features
  → temporal smoothing and sign-boundary hypotheses
  → closed-vocabulary candidate lattice
  → discourse state and constrained semantic interpretation
  → evidence-bound English realization
  → stable tentative/committed live captions
```

Keep raw video in the browser for the MVP. Send timestamped derived features to the backend only if server-side decoding is needed. Record reviewed development clips only with explicit consent.

### 1. Observations across time

Create `frontend/src/recognition/featureExtractor.ts` and replace the tutor’s four-bit reduction for recognition mode. Retain the existing drill logic unchanged.

For every sampled frame, record:

- Both hands: 21 image landmarks, 21 world landmarks, detector handedness and its score, visibility/presence, joint angles, thumb state, palm normal, finger direction, and inter-hand distance.
- Body: shoulders, elbows, wrists, nose, hips, and torso orientation. Express hand location in a body coordinate system whose origin is shoulder midpoint and scale is shoulder width.
- Face and head: brow raise/lower, eye aperture, mouth shapes relevant to the reviewed vocabulary, head nod/shake/tilt, and gaze direction. These are linguistic observations, not emotion labels.
- Motion: position, velocity, acceleration, direction changes, repeated movement, path shape, and hold duration over a ring buffer.
- Quality: per-hand visibility, landmark stability, crop margins, brightness/contrast, motion blur proxy, and whether face/torso landmarks are present.

MediaPipe Hand Landmarker already returns handedness, normalized landmarks, and world landmarks; the current component simply ignores most of them. Add Pose and Face Landmarker tasks for the missing channels. The browser should sample at a measured 20–30 fps when the device permits, with timestamps rather than assuming a fixed rate. If that rate is too slow, lower image resolution before dropping temporal coverage.

Normalize translation and body scale while retaining meaningful relations such as `hand_near_forehead`, `palm_facing_signer`, and `right_hand_moves_outward`. Canonicalize dominant/non-dominant roles only after observing a stable dominant-hand hypothesis. Never assume right-handedness from screen coordinates.

Use a small state machine before a learned temporal model:

1. `REST`: hands absent or stably at a neutral resting position.
2. `ONSET`: coordinated motion rises above a signer-adaptive threshold.
3. `ACTIVE`: stable handshape/location evidence and purposeful motion are present.
4. `HOLD`: motion falls while the configuration remains stable; this is still part of the sign.
5. `TRANSITION`: hands move between lexical targets without enough stable evidence to label a sign.
6. `BOUNDARY_CANDIDATE`: a hold, return toward rest, nonmanual release, or longer pause suggests a sign or utterance boundary.

Do not classify every frame. Maintain a 1.5–3 second rolling window and decode candidate spans. A sign boundary becomes provisional when motion energy falls and the next stable configuration differs; it becomes committed after the following sign provides enough evidence or after a reviewed end-of-utterance pause. A sentence boundary needs stronger evidence than a sign boundary: sustained rest/pause, completed question or assertion nonmanuals, or an explicit user stop. Pauses inside a sign and phrase-final holds must not automatically end a sentence.

For the first MVP, use dynamic time warping (DTW) against multiple reviewed templates per supported sign or short phrase. DTW gives useful speed tolerance without model training. A continuous sequence decoder can combine template emission costs with allowed transitions and an explicit `TRANSITION/BLANK` state. A trained temporal convolution, Transformer, or CTC model becomes appropriate only after collecting enough signer-diverse labeled sequences.

### 2. Context without invention

Add `backend/asl_recognition/context.py` with a compact discourse state:

```json
{
  "utterance_candidates": [],
  "referents": [{"id": "person_a", "locus": "left", "label": null}],
  "active_topic": null,
  "time_frame": null,
  "unresolved": [],
  "committed_evidence_ids": []
}
```

The visual decoder should output an N-best lattice, not one gloss string. Each candidate token carries its time span, visual posterior, observed phonological features, and evidence IDs. The interpreter may use prior turns to re-rank candidates when context truly distinguishes them. For example, a clearly established spatial locus can resolve `IX-left` to `person_a`; context cannot turn an unobserved location into a named person.

Represent questions, negation, emphasis, and time as semantic features attached to observed spans:

- Manual `NOT`, head shake, or another reviewed construction can support negation. Missing face evidence means negation may remain unresolved; it does not mean positive polarity.
- Brow and head observations can support yes/no or WH question scope. Punctuation in generated English must come from this evidence.
- Topic and time expressions set a scoped frame that later predicates may inherit only within the reviewed construction rules.
- Spatial indexing creates and reuses referents. Keep labels such as “that person” when identity is unknown.
- Repetition or enlarged movement may support aspect or emphasis only for constructions approved by the ASL reviewer.

Use an LLM only after visual decoding has produced bounded candidates and semantic atoms. Give it a strict schema and require every output fact to cite one or more evidence IDs. Allowed operations are selecting among candidates, resolving a referent from existing discourse state, and expressing supported atoms in English. It may not introduce a person, object, action, polarity, tense, number, or certainty absent from evidence. Reject any result containing an unsupported semantic atom and fall back to the best literal or explicitly uncertain output. Structured output guarantees schema shape, not factual correctness, so deterministic evidence validation remains required.

### 3. Realistic edge cases

| Case | MVP handling | Later work/data needed |
| --- | --- | --- |
| Fast/slow signing | Timestamped features, adaptive onset thresholds, DTW alignment, and several speed variants per template. | Signer-diverse continuous training data for learned speed invariance. |
| Left-handed signing | Keep detector handedness, detect display mirroring, and map to dominant/non-dominant roles. Include left-handed templates/tests. | More left-handed signers in training and evaluation. |
| Regional/individual variants | Store multiple reviewed variants under one meaning, return variant ID, and avoid penalizing a known variant. | Reviewer-approved regional coverage and provenance. |
| Fingerspelling, names, numbers | Route a detected fingerspelling span to a separate character/number decoder. Preserve uncertain letters, such as `A?EX`, rather than guessing a common name. | A signer-independent fingerspelling dataset; current avatar alphabet is output motion, not recognition training data. |
| Occluded hands | Mark evidence `unobservable`, retain nearby hypotheses, wait briefly, then ask for repetition if the missing segment is meaning-bearing. | Appearance features and multi-view/depth data can improve robustness. |
| Poor lighting/blur/crop | Fail the quality gate and show a concrete framing/lighting prompt. Do not report “unsupported sign.” | Robustness augmentation and diverse capture data. |
| Pauses | Use holds and surrounding motion; a pause is one boundary cue, not a boundary by itself. | Annotated continuous sequences. |
| Correction/self-repair | Keep the earlier phrase tentative when a cutoff/return/restart pattern appears; replace it with the repaired span and optionally expose “self-correction detected.” | Reviewed examples of natural repairs. |
| Incomplete signing | Emit known semantic atoms plus an unresolved tail; wait or ask to continue/repeat. | More partial-sequence tests. |
| Clear but unknown sign | Quality is good and no candidate exceeds the open-set threshold: `unsupported_sign`. | Add reviewed examples or retrain the vocabulary. |
| Unclear observation | Quality/visibility is below threshold: `observation_failure`. | Better capture or robust visual models. |

The last two outcomes must remain separate in the API and UI. “Unsupported” means the system saw the signing clearly but lacks a reliable label. “Could not observe” means no vocabulary decision is justified.

### 4. Uncertainty and live behavior

Add `backend/asl_recognition/schemas.py` with separate calibrated fields:

```json
{
  "observation": {"quality": 0.91, "coverage": 0.86, "failure": null},
  "recognition": {"candidates": [{"label": "RIGHT_OR_CORRECT", "p": 0.58}], "margin": 0.12},
  "interpretation": {"candidates": [{"english": "That's correct.", "p": 0.72}], "unresolved": []},
  "status": "tentative",
  "evidence_ids": ["span-18"]
}
```

These values have distinct meanings:

- Observation confidence: could the required articulators be seen and tracked?
- Recognition confidence: how concentrated is the calibrated visual candidate distribution?
- Interpretation confidence: after context, how strongly does evidence support one meaning over alternatives?
- Realization validity: did the English output preserve all supported semantic atoms and add none? This is a pass/fail validator, not model confidence.

Calibrate recognition and interpretation on held-out signers. Do not use an LLM’s self-reported confidence. Suggested starting policy, to be tuned on evaluation data:

- Wait for more frames while the sign is active or candidate margin is below 0.15.
- Show a gray tentative caption when observation quality is at least 0.70 and one interpretation exceeds 0.55.
- Revise only the uncommitted suffix. Require the same leading hypothesis for 250–400 ms before displaying it.
- Commit a span when the boundary is confirmed and interpretation confidence is at least 0.80, or when a closed reviewed phrase matches below a stricter distance threshold.
- Ask to repeat when a sentence-ending boundary arrives with observation coverage below 0.65 or the top two meaning candidates remain close.
- Display “sign not in supported vocabulary” only when observation is good and open-set distance is high.

Keep two text buffers in the UI: an immutable committed prefix and a tentative suffix. Update at most 4–6 times per second, preserve the longest common prefix between hypotheses, and delay capitalization/punctuation until boundary evidence arrives. This prevents flicker and premature English word order.

### 5. Fluid English that preserves meaning

Do not translate directly from landmarks to prose. Build an intermediate semantic representation first:

```json
{
  "speech_act": "question",
  "predicate": "understand",
  "arguments": [{"role": "experiencer", "referent": "addressee"}],
  "polarity": "negative",
  "time": null,
  "aspect": null,
  "references": [],
  "uncertain": []
}
```

A constrained realizer can turn that into “Don’t you understand?” or “You don’t understand?” only if the question scope and negative polarity are supported. When pragmatic force is ambiguous, prefer a faithful literal form such as “You do not understand?” and expose alternatives. Preserve names, numbers, time, role assignments, and unknown referents verbatim. Fluency edits may insert English function words and reorder supported constituents; they may not add events, causality, identity, emotion, or certainty.

For the hackathon vocabulary, start with deterministic English templates per reviewed construction. Use an LLM only as an optional second realizer and accept its output only when a semantic coverage checker proves that each required atom appears and no forbidden atom was added.

## Concrete ambiguous example

Assume the camera observes a short utterance after a prior English/system context of “Is twelve the answer?”

1. **Frame observations:** right dominant hand; reviewed handshape and movement match a lexical item whose English senses include RIGHT/CORRECT; face and torso visible; no negation; assertion boundary at 1.4 s.
2. **Visual candidates:** `RIGHT_OR_CORRECT` 0.58, `TRUE` 0.30, `UNKNOWN` 0.12. Observation quality 0.92. The visual model has not “translated” the sense.
3. **Contextual candidates:** “That is correct.” 0.74, “It is on the right.” 0.19, unresolved 0.07. The answer-question context supports the correctness sense. Both outputs cite the same observed sign span plus the prior question’s answer referent.
4. **Final output:** “That’s correct.” Commit after the assertion boundary. The contraction is an English realization choice; correctness and the referent are evidence-bound.

Without the prior question or spatial evidence, the system must preserve ambiguity: tentative caption **“right / correct”** and `needs_context`, not a fluent guess. If the hand was cropped during the discriminating movement, output **“I couldn’t see that sign clearly—please repeat”** (`observation_failure`). If the movement was clear but far from every supported template, output **“Sign not in supported vocabulary”** (`unsupported_sign`).

## Highest-impact changes

| Priority | Change | Current failure addressed | Code location | Evidence/data required | Test for improvement | Feasibility / latency / effort |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Honest mode boundary and ASL-to-English schemas | Existing UI can be mistaken for recognition; failures collapse into one outcome. | New `backend/asl_recognition/schemas.py`; new recognition UI separate from `Live.tsx`. | None. | Contract tests for `observation_failure`, `unsupported_sign`, `tentative`, `committed`. | High / negligible / 0.5–1 day |
| P0 | Holistic timestamped feature buffer and quality gate | Four finger bits cannot represent a sign or nonmanual grammar. | New `frontend/src/recognition/featureExtractor.ts`, `quality.ts`, `useSignCamera.ts`. Reuse MediaPipe setup from `Tutor.tsx`. | Reviewed list of required articulators per target sign. | Replay clips with crop, blur, occlusion, lighting, left/right mirror; verify correct failure reason. | High / 20–40 ms per sampled frame on target laptop, benchmark required / 1–2 days |
| P0 | Reviewed closed-domain templates with DTW and blank/transition state | No temporal recognition or segmentation exists. | New `frontend/src/recognition/decoder.ts` or backend equivalent; `data/asl_recognition/templates/`. | At least 5–10 examples per target from 3–5 signers, signer consent, exact span boundaries, dominant hand, variant, meaning. | Leave-one-signer-out sign/phrase accuracy, boundary F1, open-set false accept rate, speed perturbations. | Medium / target under 150 ms/window / 2–4 days after data exists |
| P1 | Candidate lattice and discourse state | One-best decisions lose ambiguity and spatial references. | New `backend/asl_recognition/context.py` and WebSocket/session store. | Reviewed constructions for loci, question scope, negation, and time in the chosen domain. | Ambiguous pairs with/without context; referent carryover and reset tests. | High / under 20 ms rules, plus optional model / 1–2 days |
| P1 | Evidence-constrained English realizer | Fluent output can add unsupported meaning. | New `backend/asl_recognition/realizer.py`; reuse a stricter version of `planner.py`’s Pydantic/structured-output pattern. | Semantic references and forbidden-inference annotations. | Atom recall, unsupported-atom rate, polarity/number/time exact checks, reviewer pairwise judgments. | High for templates, medium for LLM validation / 10–500 ms / 1–2 days |
| P1 | Stable partial captions | Per-window changes would flicker and commit too early. | New `frontend/src/recognition/stabilizer.ts`; render committed and tentative buffers. | Recorded streaming traces. | Revision rate, time-to-correct-commit, final semantic accuracy, no edits to committed prefix. | High / 250–400 ms intentional stabilization / 1 day |
| P2 | Fingerspelling sub-decoder | Names and novel terms cannot be recognized. | Dedicated `fingerspellingDecoder.ts` and routing state. | Signer-diverse letter/number sequences with transitions and coarticulation. | Character error rate, exact name/number match, uncertainty retention. | Low without data / variable / several days to weeks |
| P3 | Trained continuous model | Template matching will not scale across unrestricted phrases and signers. | Separate training project; export a browser/server inference model. | Large, licensed, signer-diverse continuous ASL video with gloss/semantic alignment and nonmanual annotations. | Strict signer-held-out recognition and translation evaluation plus Deaf signer review. | Low for hackathon / hardware dependent / weeks to months |

## Evaluation set and gates

The companion file [`data/asl_to_english/evaluation_cases.json`](../data/asl_to_english/evaluation_cases.json) defines the first behavioral cases. Add actual consented video IDs and annotations before scoring. Split by signer, not random clips, so the same person cannot appear in both train and test.

Measure each stage separately:

- Capture: required-articulator coverage, handedness stability, crop/occlusion detection, usable-frame rate.
- Segmentation: sign-boundary precision/recall/F1 and end-of-utterance latency.
- Recognition: top-1/top-3 accuracy on supported signs, open-set false acceptance, calibration error, and results by signer/lighting/speed/handedness.
- Meaning: semantic atom precision/recall; exact negation, question type, time, number, participant role, and reference consistency.
- English: unsupported-atom rate must be zero on the release set; meaning-preserving reviewer preference; partial-caption revisions and commit latency.

Required cases include positive versus negative minimal pairs, spatial references across turns, WH versus yes/no questions, time scope, fingerspelled names, numbers, unseen signers, left-handed signing, fast/slow signing, occlusion, crop, self-correction, incomplete utterances, clear unknown signs, and unobservable known signs.

A fluent ASL signer must review:

- Vocabulary and regional variants chosen for the MVP.
- Sign and sentence boundary annotations.
- Which manual and nonmanual evidence carries each semantic atom.
- Reference/locus and classifier interpretations.
- Whether the final English preserves intent and does not overstate an ambiguous source.
- Every golden evaluation clip and any demo claim about accuracy.

Software tests can prove schema conformance, temporal stability, calibration calculations, and preservation of annotated atoms. They cannot establish that a construction or interpretation is correct ASL.

## Strongest achievable MVP

1. Choose 10–20 classroom intents, not arbitrary sentences: greeting, yes/no, request repetition, request help, understand/do-not-understand, question, bathroom, water, name/fingerspelling, and a few time/number examples.
2. Have a fluent ASL reviewer define accepted variants, nonmanual requirements, intended English meanings, ambiguity notes, and utterance boundaries.
3. Record 5–10 examples per target from at least 3–5 signers, including one left-handed signer if possible, plus open-set and degraded-quality clips. Hold one signer out entirely.
4. Implement holistic feature extraction, quality gating, dominant-hand normalization, the temporal state machine, and DTW templates. Decode an N-best lattice with explicit blank/transition/unknown states.
5. Add deterministic discourse rules for the reviewed constructions and template-based English realization. Keep ambiguous output tentative or explicit.
6. Add stable live captions, separate observation and interpretation confidence, and clear repeat/unsupported states.
7. Run the machine checks and signer-held-out evaluation, then have the ASL reviewer watch every release example and approve the displayed meaning.

What is needed from the team is the linguistic and visual evidence the repository does not contain: a fluent ASL reviewer; the target 10–20 classroom intents; consented recordings from several signers; accepted regional scope; and a decision about whether derived landmarks may leave the browser. Until those exist, engineering can build the capture, schema, quality, buffering, replay, and evaluation harness, but it cannot honestly label recognition as accurate.

## Sources

- [MediaPipe Hand Landmarker result](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/HandLandmarkerResult): handedness, normalized landmarks, and world landmarks available from the detector.
- [How2Sign paper](https://openaccess.thecvf.com/content/CVPR2021/papers/Duarte_How2Sign_A_Large-Scale_Multimodal_Dataset_for_Continuous_American_Sign_Language_CVPR_2021_paper.pdf): continuous ASL data includes body, face, hands, gloss alignment, and multiple visual modalities.
- [WLASL paper](https://openaccess.thecvf.com/content_WACV_2020/papers/Li_Word-level_Deep_Sign_Language_Recognition_from_Video_A_New_Large-scale_WACV_2020_paper.pdf): word-level ASL recognition benchmarks both appearance and pose-based temporal approaches and illustrates the need for signer-diverse data.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema-constrained model output. Schema adherence does not replace evidence validation.
- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): define objectives and metrics, use representative expert-labeled datasets, and prefer classification/scoring over unconstrained judging.


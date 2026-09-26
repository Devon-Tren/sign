# SIGN — Product Vision & Hackathon Plan

SIGN explores two connected goals: making spoken content more accessible through an ASL avatar and helping people learn ASL through demonstrations and camera-based practice. Both experiences share a sign library and a 3D avatar.

This document consolidates the original brainstorm into a product concept and development plan. **Features below are proposed unless explicitly described as current.** See the [README](../README.md) for setup and implemented functionality, and the [Hackathon Guide](HACKATHON_GUIDE.md) for the current demo script.

## 1. Motivation

The idea began in a computer science class where a Deaf student attended lectures with an ASL interpreter. That experience raised a question: how could technology provide additional access when an interpreter is unavailable?

The same technology could also help learners see a sign, examine its movement, practice it, and receive useful feedback.

SIGN is intended as a supplemental learning and accessibility tool. The long-term vision requires accurate, reviewed signing; it is not a replacement for qualified ASL interpreters.

## 2. Product Modes

| Mode | Purpose | Proposed experience |
| --- | --- | --- |
| **Live** | Support access to spoken content | Speech becomes captions and a supported signing sequence performed by the avatar. |
| **Learn** | Demonstrate and explain signs | Learners explore lessons, replay signs, adjust playback speed, and rotate or zoom the avatar. |
| **Mirror** | Guide signing practice | Learners attempt a sign on camera and receive feedback on specific aspects of their movement. |

### Live: Speech to Signing

The intended flow is:

```text
Speech → Transcript → Supported phrase mapping → Sign motion → Avatar
             └──────────────────────────────────────────────→ Captions
```

The hackathon version should use a small catalog of reviewed phrases rather than attempt unrestricted translation. Unsupported speech should remain visible as captions with a clear indication that no signing is available.

ASL has its own grammar and structure. Selecting sign tokens or playing animations in sequence does not, by itself, produce accurate ASL interpretation.

### Learn: Avatar-Led Lessons

Learners select a sign or supported phrase and study its demonstration using replay, pause, speed, rotation, and zoom controls. Short instructions explain what to observe and practice.

The proposed lesson progression is:

1. **Alphabet:** Learn letters and introductory fingerspelling.
2. **Your name:** Apply fingerspelling to a familiar word.
3. **Greetings:** Practice common greetings and polite expressions.
4. **Everyday conversation:** Combine reviewed signs into simple exchanges.

For the hackathon, start with lessons supported by the available sign assets. A complete alphabet and conversation curriculum can follow later.

### Mirror: Camera-Based Practice

Mirror Mode compares a learner's attempt with a reference for the selected sign. Proposed feedback dimensions include:

- **Handshape:** Finger configuration and joint angles.
- **Position:** Hand location relative to the body.
- **Orientation:** Direction of the palm and fingers.
- **Movement:** Path, direction, and extent of motion.

Body posture and facial expression are future extensions. Feedback should explain a measurable difference, such as “move your hand farther outward,” instead of only showing a score.

## 3. Hackathon Scope

The core demonstration should connect all three modes through the same animation library.

| Mode | Target demonstration |
| --- | --- |
| Live | Speak a supported phrase, show the transcript, and play its signing animation. |
| Learn | Select a sign and inspect it with replay, slower playback, and rotation. |
| Mirror | Attempt a supported sign on camera and receive a score with specific feedback. |

**Target scope:** 10–20 signs, 3 short lessons, 5 supported demo phrases, and 3–5 signs available for Mirror practice. Expand toward the original 20–30-sign idea only if the core flow is reliable.

Candidate vocabulary includes HELLO, THANK YOU, PLEASE, YES, NO, HELP, SORRY, TEACHER, STUDENT, LEARN, UNDERSTAND, AGAIN, QUESTION, FRIEND, WATER, BATHROOM, GOOD, MORNING, NAME, ME, and YOU.

Candidate phrase meanings include “Please help,” “I don't understand,” “Can you repeat?” and “What is your name?” These are content-planning examples; their signing sequences require ASL review.

### Current Prototype

The repository README describes a narrower implementation: live captions, closed-catalog phrase retrieval, 12 illustrative procedural avatar motions, and basic MediaPipe handshape drills. **The bundled motions are unverified placeholders, and the tutor does not assess complete ASL signs or fluency.**

The proposed sign library and Mirror assessments above remain development targets.

## 4. Shared Architecture

```text
LIVE                         LEARN                         MIRROR
Microphone                   Lesson selection              Webcam
    ↓                            ↓                            ↓
Speech-to-text               Sign lookup                   Hand/body tracking
    ↓                            ↓                            ↓
Supported phrase mapping     Shared sign library           Normalized features
    ↓                            ↓                            ↓
Animation queue ───────────→ Avatar playback                Reference comparison
                                                              ↓
                                                           Feedback
```

### Sign Library

Each sign should connect its teaching content, playback asset, and practice reference. Suggested fields are:

| Field | Purpose |
| --- | --- |
| `sign_id`, `name` | Stable identifier and display label |
| `duration` | Playback length |
| `animation_file` | Avatar animation asset |
| `reference_motion` | Tracking data or derived features for practice comparison |
| `instructions` | Learner-facing guidance |
| `difficulty`, `lesson` | Curriculum organization |
| `validation_status` | Distinguish illustrative assets from reviewed signing |
| `source`, `license` | Asset provenance and permitted use |

Live and Learn use the same playback assets. Mirror uses a corresponding reference in a comparable coordinate and feature representation.

### Technology Direction

The original brainstorm proposed React or Next.js, Three.js or React Three Fiber, a rigged GLB/VRM avatar, MediaPipe hand/body tracking, speech recognition, and a lightweight backend. JSON files would be sufficient for initial lesson metadata; accounts and a hosted database are optional future work.

The current repository uses **React/TypeScript, Three.js, FastAPI, SQLite, OpenAI transcription/phrase retrieval, and MediaPipe Hand Landmarker**. Continue with that stack while proving the core experience.

## 5. Technical Priorities

### Prove the Avatar First

The first milestone is a single recognizable, reviewed sign with accessible hand and finger controls. Start with HELLO, then add a few signs before scaling the library.

One proposed asset pipeline is:

```text
Signer reference video → Tracked landmarks → Coordinate normalization
→ Skeleton retargeting → Animation cleanup → ASL review
```

Landmark capture is a starting point, not a finished animation. Finger articulation, orientation, occlusion, body movement, and facial expression may require additional work. If accurate avatar control cannot be demonstrated early, reduce the scope before building dependent features.

### Compare Practice Attempts

For a small set of selected signs, begin with explicit similarity measurements rather than training a general sign-recognition model.

1. Capture hand landmarks and any required body landmarks.
2. Normalize measurements for body size, camera position, and reference conventions.
3. Extract handshape, position, orientation, and movement features.
4. Align the attempt with the reference; explore dynamic time warping for different signing speeds.
5. Produce feedback from the measured differences.

An initial scoring experiment could use:

```text
overall = 0.35 × handshape
        + 0.25 × position
        + 0.25 × movement
        + 0.15 × orientation
```

These weights are a prototype hypothesis, not a validated measure of ASL accuracy. Calibrate them against reviewed examples and avoid scoring attempts when tracking is insufficient.

### Constrain Live Phrase Selection

Use a deterministic dictionary for demo phrases. An optional language model can select from the supported catalog, with output validated against available IDs. Unmatched input should keep its captions and indicate that signing is unavailable.

## 6. Build Order & Checkpoints

| Phase | Deliverable |
| --- | --- |
| 1. Avatar proof | Load the rig, access finger bones, and play one test sign with replay and speed controls. |
| 2. Shared library | Establish the asset format and add a few reviewed reference signs. |
| 3. Tracking proof | Display the webcam and obtain stable hand landmarks. |
| 4. Practice loop | Compare one supported attempt and provide a useful correction. |
| 5. Learn | Connect sign selection, lesson instructions, and avatar controls. |
| 6. Live | Add transcription, supported phrase mapping, and animation sequencing. |
| 7. Demo polish | Expand the reliable content set, refine feedback, and prepare the presentation. |

**First four hours:** Run the app, load the avatar, access hand bones, display the webcam, obtain landmarks, and attempt one animation.

**Halfway point:** Aim for 5–10 playable signs, 1–2 practice comparisons, and working transcription. Prioritize integration over new architecture.

**Final stretch:** Stabilize the target content set, test the full demo, prepare a short pitch, and record a backup demonstration for microphone, webcam, or network failures.

### Suggested Team Split

| Owner | Focus |
| --- | --- |
| Avatar / graphics | Rigging, animation assets, playback, and sign fidelity |
| Computer vision | Tracking, motion comparison, and Mirror feedback |
| Backend / speech | Transcription, phrase mapping, and API integration |
| Frontend / learning | Lessons, navigation, playback controls, and demo polish |

Prioritize help for avatar work when it blocks the other modes.

## 7. Future Development

After the core experience is reliable, expand into watch-and-identify exercises, fingerspelling practice, supported speak-to-learn requests, and personalized review based on previous attempts. Conversation practice and richer facial/body feedback are longer-term goals.

Keep full-vocabulary translation, custom model training, native mobile apps, payments, social features, leaderboards, and production-scale infrastructure outside the hackathon scope.

The strongest proposed demo is a complete learning loop: **watch a reviewed sign, attempt it, receive a specific correction, and try again.**

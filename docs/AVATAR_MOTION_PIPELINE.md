# Live signing and avatar motion pipeline

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
- Eleven motion entries are derived from ASL-LEX phonological descriptors; 92
  are application-authored procedural candidates.
- No construction or motion has an approved signer-review record.
- Unknown concepts remain visibly labelled fingerspelling approximations.
- The procedural renderer now clamps finger and thumb joints, limits wrist
  swing, keeps approximate targets in front of the torso, uses a visible neutral
  stance, completes onset/hold/release within the advertised duration, and
  blends adjacent signs over a short coarticulation window.

Those changes prevent many impossible poses, but a descriptor such as "curved
movement near the head" is still not a recorded human performance.

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

# sign.

**Live-caption and illustrative-avatar accessibility research prototype.**

The bundle includes a React/TypeScript app with an interactive 3D full-body character, a FastAPI API, OpenAI realtime transcription bridge, SQLite phrase catalog, a simulated lecture, and a MediaPipe handshape tutor. All bundled gestures are **unverified procedural placeholders**, *not* ASL. Do not use this prototype as a replacement for a qualified human ASL interpreter.

## Start the demo (no API key)

Prerequisites: Node.js 20+, npm, Python 3.11+, modern Chrome/Edge/Safari, internet to install dependencies. To load MediaPipe's tracker model you'll also need internet access at runtime.

Open two terminals:

**Terminal 1 — backend:**

```bash
cd sign/backend
python3 -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env      # Windows: copy .env.example .env
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend:**

```bash
cd sign/frontend
npm install
npm run dev
```

Open http://localhost:5173 (if it doesn't load, use http://127.0.0.1:5173). Click **Run sample lecture**. You can also type phrases, explore the 3D model, browse the library and visit the tutor. The demo works without the backend too, using the bundled phrase catalog.

## Structured ASL planning

The backend planner produces a candidate gloss, intended meaning, expression
spans, and animation timeline. Unknown concepts are fingerspelled; with
`OPENAI_API_KEY`, a two-stage model can first extract meaning and then construct
a gloss from playable signs. The live screen calls the deterministic fast path
so typing does not wait for a model round trip.

These are unreviewed fixtures, not verified translations. Live typed text and
finalized microphone transcripts use the fast Smart Sign Gate: exact stored phrases pass immediately,
ambiguous aliases require supporting recent context, and unmatched text gets a
clearly labelled deterministic fingerspelling fallback. No approved constructions are bundled. See
[the planner contract and required assets](backend/README.md#experimental-asl-planning).

The hackathon demo includes a [48-input classroom dataset](data/asl/demo_utterances.json)
covering help, clarification, introductions, directions, basic needs,
understanding, classroom questions, and wellbeing. Each exact input compiles to
playable candidate motion without spelling unknown English terms; Hector and
Maya remain fingerspelled as proper names. These candidates still require fluent
ASL review before they can be described as accurate translations.

## Enable microphone transcription

Click **Start microphone** and grant microphone permission on localhost. In Chrome or Edge, the app can use the browser's Speech Recognition service for partial and final captions without an OpenAI key.

Server-side microphone transcription requests the browser's echo cancellation, noise suppression, and automatic gain control, then filters low rumble and high hiss and gently reduces very quiet background audio before sending it. Quiet gaps remain in the stream for speech detection. The connection status shows when this local filter is on. Browser Speech Recognition captures audio separately and uses browser-managed processing instead.

For server-side OpenAI transcription:

1. Copy `sign/backend/.env.example` to `sign/backend/.env`.
2. Set `OPENAI_API_KEY=...` in **backend/.env only**. Never use `VITE_` to expose a secret in the frontend.
3. Restart the backend. The frontend connection indicator should say **Live API configured**.
4. Click **Start microphone**, speak clearly, and pause between clauses.

The backend sends mono 24 kHz PCM through a server-only WebSocket, segments
speech with simple energy VAD, and uses `gpt-live-transcribe`. If that connection
is unavailable, the app automatically tries browser speech recognition. Final
text is checked against the stored catalog and recent context. Unsupported text
remains captioned and gets a clearly labelled deterministic fingerspelling
fallback; it is never presented as a database match.

API usage incurs charges. MediaPipe webcam tracking runs on device, but the model and WASM runtime are downloaded from Google's model host and jsDelivr at first launch. Never record or transmit someone else's lecture without permission.

## Included functionality

| Screen | Capability | Status |
|---|---|---|
| Classroom | React UI, animated 3D person with face, finger bones, orbit controls | Implemented; gestures **illustrative only** |
| Classroom | Simulated streaming six-line lecture | Works without API key |
| Classroom | Browser microphone transcription | Integrated; requires browser support, network, and microphone permission |
| Classroom | Server-side realtime microphone transcription | Integrated; requires API key, model access, network, browser mic permissions |
| Classroom | Ordered animation queue and transcript export | Implemented |
| Classroom | Context-aware Smart Sign Gate with confidence threshold and visible fingerspelling fallback | Integrated; 12 starter concepts |
| API/evaluation | Structured gloss planning and fingerspelling fallback | Integrated; experimental |
| Library | SQLite phrase catalog, search, per-phrase preview and metadata | Implemented; 12 **unverified** starter clips |
| Tutor | Webcam MediaPipe hand detection + finger-joint measurements | Integrated; browser permission and model download required |
| Tutor | 4 handshape drills across 3 levels, per-finger corrective guidance, persistence | Implemented; **not** ASL recognition |
| Tutor | Optional GPT-4.1 explanations using measured finger states only | Integrated; requires key |
| Settings | API health and configuration guidance | Implemented |

## Why the signing is marked as a placeholder

English-to-ASL cannot be implemented by rearranging words and linking generic videos. Accurate interpretation requires ASL grammatical structure, classifier constructions, signing space, non-manual markers, coarticulation, fingerspelling, dialect and context. All 12 starter entries are **illustrative**, and the SQLite metadata enforces a clear `illustrative` / `validated` distinction. The UI prominently labels unverified content, and unrecognized speech remains captioned.

The next milestone is to obtain appropriately licensed, Deaf-signer-validated skeletal clips with facial blendshapes, update the SQLite `animation_file` column and `validation_status`, and replace `motionFor()` with glTF animation mixing (`THREE.AnimationMixer`). Review each lesson/reference sequence with a qualified signer before any real accessibility deployment.

## Key files

```
sign/
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # Screen navigation
│   │   ├── components/
│   │   │   ├── Live.tsx           # Transcription / queue / lecture demo
│   │   │   ├── Avatar.tsx         # Three.js articulated human (placeholder)
│   │   │   ├── Tutor.tsx          # MediaPipe practice and feedback
│   │   │   ├── Library.tsx        # Phrase browsing / preview
│   │   │   └── Settings.tsx
│   │   ├── hooks/useLiveAudio.ts  # AudioWorklet resampler / mic WebSocket
│   │   ├── clips.ts              # Procedural placeholder motions
│   │   ├── data.ts               # Offline demo data
│   │   ├── api.ts                # REST / WebSocket endpoint config
│   │   └── styles.css
│   └── package.json
├── backend/
│   ├── main.py                   # FastAPI and secure streaming bridge
│   ├── interpreter.py            # Strict phrase retrieval
│   ├── db.py                     # SQLite schema + seed data
│   ├── tests/test_api.py
│   └── .env.example
└── docs/
    └── HACKATHON_GUIDE.md
```

## Run tests and build

```
cd backend && python -m pytest -q
cd ../frontend && npm run build
```

The backend tests work without OpenAI credentials. `npm install` requires npm registry access; this ZIP does not contain `node_modules`. Build and API integration should be validated with your team on a network-connected machine.

## References

- OpenAI realtime transcription: https://developers.openai.com/api/docs/guides/realtime-transcription
- Google MediaPipe Hand Landmarker for Web: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js

## ASL video to English

The webcam tutor does not recognize ASL sentences. It currently compares four
straight/curled finger states against selected static drills. See the
[ASL-to-English hackathon MVP design](docs/ASL_TO_ENGLISH_MVP.md) for the audited
input gaps, temporal and contextual pipeline, uncertainty policy, edge cases,
evaluation suite, and the strongest achievable implementation plan.

## Responsible demo language

Present this as a *live caption + 3D signing architecture prototype with introductory handshape tracking*. Do not claim the bundled motions are verified ASL, that the system accurately interprets arbitrary lectures, or that its webcam tutor measures ASL fluency. If you plan a real-world trial, consult Deaf users and qualified ASL experts and include a reliable human-interpreter path.

### One-command launcher (macOS or Linux)

From a terminal in the unzipped folder, run `./start.sh`. On macOS you can also use `START_HERE.command` if your system allows local scripts. The first run installs dependencies and may take a few minutes. It will not automatically open the browser; visit http://localhost:5173. If macOS blocks the script, run `bash start.sh` from Terminal. The script creates an empty `backend/.env`; add your API key there and restart when needed.

## The avatar

The signer is a [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) avatar (MIT licensed). It has a full hand rig — 30 finger bones, three joints per finger plus an opposable thumb — which is what makes distinct ASL handshapes possible, and 175 blend shapes including FACS action units. The eight the app drives are kept and the rest discarded before upload, which saves roughly 70 MB of GPU memory.

Non-manual markers run on those action units: **AU 1+2** (inner and outer brow raise) marks yes/no questions, **AU 4** (brow lowerer) marks WH-questions. This is how ASL linguistics describes non-manuals, so the mapping is direct rather than invented.

Rebuild or swap the avatar with:

```bash
python scripts/build_avatar.py                     # current signer
python scripts/build_avatar.py Adults Male_Adult_09  # a different one
```

## How the motion is generated

Avatar motion combines published descriptors with procedural interpretation. `data/asl_lex_params.json` holds handshape, selected fingers, flexion, thumb position, location, movement, sign type and frequency for 1,279 catalog entries from **ASL-LEX 2.0**. Six additional motions are application-authored. `frontend/src/clips.ts` composes poses in a **normalised body frame** (origin at the shoulder midpoint, unit of one arm reach), and `frontend/src/signerRig.ts` resolves them onto the skeleton with two-bone IK and explicit palm orientation.

**ASL-Phono** adds consensus-gated palm and movement-direction estimates. Of 720 exact source-entry matches, 133 palm estimates and 40 movement estimates exceed 50% frame agreement. Authored orientations, contact relations, compounds and existing relocation paths take precedence: 86 signs currently use the new palm prior and 7 use the new movement direction. These are noisy estimates, not signer validation. See [source evaluation and remaining work](docs/ASL_DATA_COMPLETION.md).

Regenerate or extend the extract with:

```bash
python scripts/extract_asl_lex.py
python scripts/extract_asl_phono.py  # pinned, checksum-verified Zenodo release
npm --prefix frontend run audit
npm --prefix frontend test
```

**This is still not validated ASL.** ASL-LEX does not encode palm orientation, movement size/direction or non-manual grammar. Uncovered orientations remain authored or derived. The Motion audit view captures start, stroke and hold frames, with a top-100 frequency queue, ASL-Phono comparison toggle and downloadable contact sheet. Every entry remains a candidate until a qualified Deaf signer reviews it.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

**If you are a Deaf signer, ASL linguist or interpreter:** the most valuable thing you can file is a [sign correction](https://github.com/Devon-Tren/sign/issues/new?template=sign_correction.yml). It needs no code and no setup. Every sign here is an unverified placeholder, and corrections are the only route to changing that.

Anything that adds linguistic data must state its source and license, and must go in `data/` — see the licensing rules in CONTRIBUTING.md before doing the work.

## License

Code and datasets have separate licenses:

| Path | License | Notes |
|---|---|---|
| Everything except `data/` | [MIT](LICENSE) | Commercial use permitted |
| `data/`, except the ASL-Phono file | [CC BY-NC 4.0](data/LICENSE) | **NonCommercial only**; attribution required |
| `data/asl_phono_priors.json` | [CC BY 4.0](data/LICENSE) | Attribution required |

`data/asl_lex_params.json` is derived from [ASL-LEX 2.0](https://asl-lex.org/) (Sehyr, Caselli, Cohen-Goldberg & Emmorey, 2021), licensed CC BY-NC 4.0. Full attribution is in [NOTICE](NOTICE), and the app credits it in the Phrase library preview.

**Before any commercial use:** the NonCommercial term covers `data/` only, but the app reads that file at runtime. Remove `data/asl_lex_params.json` and source the phonological parameters independently, or obtain a separate license from the ASL-LEX authors. The MIT-licensed code is unaffected.

The bundled gestures remain unverified placeholders regardless of license terms — see "Why the signing is marked as a placeholder" above before any accessibility deployment.

See [the playback contract and reviewer workflow](docs/ASL_PLAYBACK_AND_REVIEW.md) for review packets and evaluation cases.

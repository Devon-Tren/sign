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

## Enable real microphone transcription

1. Copy `sign/backend/.env.example` to `sign/backend/.env`.
2. Set `OPENAI_API_KEY=...` in **backend/.env only**. Never use `VITE_` to expose a secret in the frontend.
3. Restart the backend. The frontend connection indicator should say **Live API configured**.
4. Click **Start microphone** and grant microphone permission on localhost. Speak clearly, pause between clauses, and watch the English captions update.
5. The backend sends mono 24 kHz PCM to OpenAI using a server-only WebSocket, segments speech with simple energy VAD and uses `gpt-live-transcribe` for partial/final transcripts. GPT-4.1, if available, selects *only* phrase IDs from the catalog. Without a key the matcher operates locally. Unsupported content stays visible in the transcript.

API usage incurs charges. MediaPipe webcam tracking runs on device, but the model and WASM runtime are downloaded from Google's model host and jsDelivr at first launch. Never record or transmit someone else's lecture without permission.

## Included functionality

| Screen | Capability | Status |
|---|---|---|
| Classroom | React UI, animated 3D person with face, finger bones, orbit controls | Implemented; gestures **illustrative only** |
| Classroom | Simulated streaming six-line lecture | Works without API key |
| Classroom | Server-side realtime microphone transcription | Integrated; requires API key, model access, network, browser mic permissions |
| Classroom | Independent animation queue, replay, pause, speed, transcript history, export | Implemented |
| Classroom | GPT-4.1 closed-catalog phrase selection / offline heuristic | Integrated / fallback |
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

## Responsible demo language

Present this as a *live caption + 3D signing architecture prototype with introductory handshape tracking*. Do not claim the bundled motions are verified ASL, that the system accurately interprets arbitrary lectures, or that its webcam tutor measures ASL fluency. If you plan a real-world trial, consult Deaf users and qualified ASL experts and include a reliable human-interpreter path.

### One-command launcher (macOS or Linux)

From a terminal in the unzipped folder, run `./start.sh`. On macOS you can also use `START_HERE.command` if your system allows local scripts. The first run installs dependencies and may take a few minutes. It will not automatically open the browser; visit http://localhost:5173. If macOS blocks the script, run `bash start.sh` from Terminal. The script creates an empty `backend/.env`; add your API key there and restart when needed.

## How the motion is generated

Avatar motion is composed from published phonological descriptors rather than hand-invented joint angles. `data/asl_lex_params.json` holds the handshape, selected fingers, flexion, thumb position, location, movement and sign-type values for 11 catalog entries, extracted from **ASL-LEX 2.0**. At runtime `frontend/src/clips.ts` combines three libraries — handshapes, location anchors and movement primitives — into a pose, and `Avatar.tsx` resolves that pose with two-bone IK and explicit palm orientation.

Regenerate or extend the extract with:

```bash
python scripts/extract_asl_lex.py
```

**This is still not validated ASL.** ASL-LEX *describes* signs; it is not an animation specification. Rendering "Curved movement at Head/Mouth" as a trajectory is interpretation, and palm orientation is an authored layer that ASL-LEX does not supply at all. Every entry stays `illustrative` until a qualified Deaf signer reviews it.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

**If you are a Deaf signer, ASL linguist or interpreter:** the most valuable thing you can file is a [sign correction](https://github.com/Devon-Tren/sign/issues/new?template=sign_correction.yml). It needs no code and no setup. Every sign here is an unverified placeholder, and corrections are the only route to changing that.

Anything that adds linguistic data must state its source and license, and must go in `data/` — see the licensing rules in CONTRIBUTING.md before doing the work.

## License

This repository is **dual-licensed**. The two licenses are not interchangeable:

| Path | License | Notes |
|---|---|---|
| Everything except `data/` | [MIT](LICENSE) | Commercial use permitted |
| `data/` | [CC BY-NC 4.0](data/LICENSE) | **NonCommercial only**; attribution required |

`data/asl_lex_params.json` is derived from [ASL-LEX 2.0](https://asl-lex.org/) (Sehyr, Caselli, Cohen-Goldberg & Emmorey, 2021), licensed CC BY-NC 4.0. Full attribution is in [NOTICE](NOTICE), and the app credits it in the Phrase library preview.

**Before any commercial use:** the NonCommercial term covers `data/` only, but the app reads that file at runtime. Remove `data/asl_lex_params.json` and source the phonological parameters independently, or obtain a separate license from the ASL-LEX authors. The MIT-licensed code is unaffected.

The bundled gestures remain unverified placeholders regardless of license terms — see "Why the signing is marked as a placeholder" above before any accessibility deployment.

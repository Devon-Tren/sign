# SIGN — 2-minute hackathon demo script

## The problem (15 seconds)
Traditional caption-only tools expose spoken words but don't demonstrate sign language. A full ASL interpretation platform requires validated 3D signing assets and context-aware language processing. This prototype demonstrates the underlying infrastructure while explicitly labeling unfinished interpretation.

## Demonstrate the classroom (50 seconds)
1. Run sample lecture. English captions populate independently of the avatar.
2. The phrase retrieval engine matches items from a **closed catalog**.
3. The 3D human plays **illustrative procedural motions**, showing animation queue/replay/speed controls; rotate it with the mouse.
4. Type an unknown phrase: the transcript stays present and the interface labels it **Captions only**, not a fictional translation.
5. If you have an API key configured, stop the sample demo and speak into the microphone. Show partial then finalized captions and the strict phrase matcher.

## Demonstrate handshape practice (45 seconds)
1. Open Learning studio, enable webcam, wait for MediaPipe to download the model.
2. Practice open palm / fist / index extension. The tracker compares basic finger-joint angles; show a specific finger correction.
3. Hold the pose across 12 matching frames to complete a drill. Progress persists in your browser.
4. For unreliable venue Wi-Fi, select **Try sample feedback** and disclose that it's a simulated example rather than a live assessment.

## Technology (10 seconds)
React/TypeScript, Three.js, FastAPI, SQLite, OpenAI streaming transcription and GPT-4.1 phrase retrieval, MediaPipe Hand Landmarker.

## Planned upgrade
Replace all 12 placeholder motions with independently validated, properly licensed 3D ASL clips including accurate facial grammar; collaborate with Deaf signers to review vocabulary, grammar and accessibility. Add human-interpreter fallback, real-world latency testing and rigorous accuracy evaluations before any practical deployment.

## Team split
- Frontend / UX: Live.tsx, CSS, transcript and streaming controls
- Avatar / graphics: Avatar.tsx, glTF sign clips and facial blendshapes
- AI / backend: main.py realtime pipeline + interpreter.py
- Computer vision / learning: Tutor.tsx, handshape evaluation and benchmark data

## Risk register
- **Unverified signing:** show only demonstrative gestures until signer-reviewed clip assets are integrated.
- **Realtime latency:** transcription and signing may lag behind fast lectures; never hide or silently discard unrendered captions.
- **Cost or credentials:** OpenAI is optional for the demo, but the key must stay on the backend.
- **Venue internet:** npm, MediaPipe model hosting and OpenAI API require network connectivity.
- **Privacy:** never record lectures without permission; the app has no audio/video storage by design.

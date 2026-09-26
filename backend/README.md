# Sign API

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # optional: set OPENAI_API_KEY
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- `GET /api/health` live API status
- `GET /api/phrases` phrase catalog (all seed clips illustrative / unverified)
- `POST /api/interpret` `{ "text": "..." }` selection from closed phrase library
- `POST /api/feedback` `{ "drill_name":..., "observed":..., "expected":..., "score":... }`
- `WS /ws/live` PCM16 mono 24 kHz binary audio frames, message events (`connected`, `partial`, `final`, `error`)

API key stays on the server. The upstream realtime transcription websocket uses client-independent simple RMS end-of-speech detection and commits turns after a pause or seven seconds. It is a prototype; tune RMS thresholds for actual lecture acoustics. `gpt-live-transcribe` doesn't use server VAD. In production add echo cancellation, diarization, queue backpressure, lifecycle/reconnect handling and persistence policies.

Run tests: `python -m pytest tests -q`.

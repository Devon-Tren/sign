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

## Experimental ASL planning

`POST /api/plan` accepts `{"text":"Could you explain that again?", "context":[]}`.
The classroom screen has a separate **Classroom ASL plan** preview. Typed input
and finalized microphone transcripts call this same endpoint and enter one
ordered playback queue.

Without a key, bundled examples such as `How are you?`, `What is your name?`,
and `Where is the bathroom?` use candidate gloss plans. Other input matches
known concepts and fingerspells remaining words, so it stays visibly playable.
This fallback is not grammatical ASL translation.

With a server-side `OPENAI_API_KEY`, other messages use two structured-output
calls with `OPENAI_TEXT_MODEL`: meaning extraction, then construction using the
full catalog. See the [OpenAI structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs).
The model can use registered signs or `FS:WORD` tokens for unsupported concepts.
Model failures fall back to the same visible fingerspelling path.

The seed examples and rendered motions are unreviewed. Typed and microphone
inputs now share the planner. Candidate playback is enabled for this hackathon
prototype and remains labelled experimental. Set `SIGN_PLAYBACK_POLICY=reviewed-only`
to block everything without a current review fingerprint. The motion contract
and reviewer workflow are described in
[ASL playback and review](../docs/ASL_PLAYBACK_AND_REVIEW.md).

## MongoDB catalog

The app uses bundled JSON by default. To run a local MongoDB Community catalog:

```bash
docker compose -f docker-compose.mongo.yml up -d
```

Set these values in `backend/.env` and restart the API:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=sign
```

Startup seeds `signs`, `profiles`, `examples`, and `metadata` collections from
the versioned repository data. Existing records with matching IDs are updated;
additional records are preserved. `GET /api/health` reports `mongodb`, `json`,
or `json-fallback`. If MongoDB is unavailable, translation continues using JSON.

Run `python -m pytest tests -q` for the offline integration and validation suite.

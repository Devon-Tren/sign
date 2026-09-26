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
The classroom screen has a separate **Classroom ASL plan** preview. Candidate plans have an explicit rehearsal preview; only approved complete
constructions enter live playback.

Without a key, exact examples in `../data/asl/catalog.json` work (case, whitespace, and
terminal punctuation may vary). Try `Do you understand?` or `Could you explain
that again?`. Other inputs return an explicit unavailable result. Nonempty
context requires the model path so context-dependent meanings are not silently
replaced with a fixed example.

With a server-side `OPENAI_API_KEY`, other messages use two structured-output
calls with `OPENAI_TEXT_MODEL`: meaning extraction, then construction using the
small full catalog. See the [OpenAI structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs).
Failures or refusals return captions-only results, with no guessed sequence.

The seed examples and rendered motions are unreviewed. Typed and microphone
inputs now share the planner. Review-gated playback, rehearsal previews, the
motion contract, and the reviewer workflow are described in
[ASL playback and review](../docs/ASL_PLAYBACK_AND_REVIEW.md).

Run `python -m pytest tests -q` for the offline integration and validation suite.

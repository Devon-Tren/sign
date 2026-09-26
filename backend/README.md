# Sign API

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # optional: set OPENAI_API_KEY
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- `GET /api/health` live API status, searchable counts, and SQL/planner motion-key integrity
- `GET /api/phrases` expanded searchable catalog (all seed clips illustrative / unverified)
- `POST /api/interpret` `{ "text": "...", "context": ["..."] }` context-aware selection from the closed phrase library
- `POST /api/feedback` `{ "drill_name":..., "observed":..., "expected":..., "score":... }`
- `WS /ws/live` PCM16 mono 24 kHz binary audio frames, message events (`connected`, `partial`, `final`, `error`)

API key stays on the server. The upstream realtime transcription websocket uses
simple RMS end-of-speech detection and commits turns after 0.75 seconds of
silence or six seconds of continuous speech by default. Catalog expressions are
sent as bounded transcription keywords. Configure this behavior with
`SIGN_TRANSCRIPTION_DELAY`, `SIGN_SILENCE_SECONDS`, `SIGN_MAX_TURN_SECONDS`,
`SIGN_TRANSCRIPTION_PROMPT`, and pipe-separated `SIGN_TRANSCRIPTION_KEYWORDS`.
It is a prototype; tune against actual lecture acoustics. `gpt-live-transcribe`
uses manual client-side commits rather than server VAD. In production add
diarization, stronger lifecycle/reconnect handling, item ordering, and explicit
persistence policies.

Run tests: `python -m pytest tests -q`.

## Experimental ASL planning

`POST /api/plan` accepts `{"text":"Could you explain that again?", "context":[]}`.
It remains an experimental planning and evaluation endpoint. Live typed and
finalized microphone input first use the closed-catalog Smart Sign Gate, then
use the deterministic `fast` planner path for visibly labelled fingerspelling
when the database has no match.

Without a key, bundled examples such as `How are you?`, `What is your name?`,
and `Where is the bathroom?` use candidate gloss plans. Other input matches
curated paraphrases first, then uses the longest playable catalog expressions
and conservative inflection matching. Curated constructions can account for
English auxiliaries such as `can` and `could`; outside those constructions the
planner preserves them rather than silently changing meaning. Fully covered input
is reported as `catalog-composed`; only remaining unsupported content is fingerspelled.
This fallback is not grammatical ASL translation.

With a server-side `OPENAI_API_KEY`, other messages use two structured-output
calls with `OPENAI_TEXT_MODEL`: meaning extraction, then construction using the
full catalog. See the [OpenAI structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs).
The model can use registered signs or `FS:WORD` tokens for unsupported concepts.
Model failures fall back to the same visible fingerspelling path.

The seed examples and rendered motions are unreviewed. Candidate playback is
enabled for this hackathon prototype and remains labelled experimental. Set
`SIGN_PLAYBACK_POLICY=reviewed-only`
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

### Growing coverage

Treat [`data/asl/phrase_seed.json`](../data/asl/phrase_seed.json) as a versioned
construction dataset, with MongoDB serving the same records at runtime. Add an
`aliases` array only when every paraphrase preserves the construction's meaning.
Adding a phrase does not create missing avatar motion: every gloss ID still needs
a registered sign asset. Names and novel proper nouns should normally remain
fingerspelled. A fluent ASL reviewer must approve the sequence, nonmanual scope,
and aliases before changing its review status from `candidate`.

SQLite additionally derives searchable illustrative rows from
`data/asl_lex_params.json` and `data/asl_custom_motions.json`. This keeps live
retrieval and the Phrase Library aligned with the 103 clips the procedural
renderer can actually address. Adding a row improves retrieval coverage; it
does not improve animation fidelity or constitute ASL validation.

The 48 hackathon target inputs live in
[`data/asl/demo_utterances.json`](../data/asl/demo_utterances.json). Startup seeds
them into the same JSON/MongoDB catalog. Every non-name gloss ID has a candidate
motion; personal names remain fingerspelled unless the person supplies an
approved name sign. The test suite compiles every target into avatar playback
and checks the requested negation, question, reference, location, number, and
date contrasts.

Run `python -m pytest tests -q` for the offline integration and validation suite.

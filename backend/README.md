# Sign API

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # optional: set OPENAI_API_KEY or GEMINI_API_KEY
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

With a server-side `GEMINI_API_KEY` or `OPENAI_API_KEY`, other messages use two
structured-output calls: meaning extraction, then construction using the full
catalog. Gemini is preferred when `GEMINI_API_KEY` is set; set
`SIGN_TEXT_MODEL_PROVIDER=openai` or `SIGN_TEXT_MODEL_PROVIDER=gemini` to choose
explicitly. `GEMINI_TEXT_MODEL` defaults to `gemini-3.5-flash-lite`, and
`OPENAI_TEXT_MODEL` defaults to `gpt-4.1`. Realtime microphone transcription
still uses the OpenAI realtime path.
The model can use registered signs or `FS:WORD` tokens for unsupported concepts.
Model failures fall back to the same visible fingerspelling path.
The response includes `fallback_reason` with a safe `code` and actionable `message`
when AI planning is skipped or fails (for example, `api_credit_exhausted`,
`api_key_missing`, or `api_timeout`). A successful model plan has
`mode: "experimental-model"` and `fallback_reason: null`; stored examples also
have no fallback reason because they intentionally bypass the model.

The seed examples and rendered motions are unreviewed. Candidate playback is
enabled for this hackathon prototype and remains labelled experimental. Set
`SIGN_PLAYBACK_POLICY=reviewed-only`
to block everything without a current review fingerprint. The motion contract
and reviewer workflow are described in
[ASL playback and review](../docs/ASL_PLAYBACK_AND_REVIEW.md).

## MongoDB catalog

Atlas also stores the searchable `phrases` collection, accounts (`users`),
expiring `sessions`, authentication rate limits, `practice_attempts`, and saved
`lecture_sessions`. Startup copies existing SQLite phrase rows with insert-only
upserts; later Atlas edits survive restarts. SQLite and bundled JSON remain
available for guest catalog use when Atlas is not configured. Account writes
require MongoDB and fail visibly if storage is unavailable.

Sign up or sign in using the account button. Passwords use salted scrypt hashes;
session tokens are stored as hashes and sent in HTTP-only SameSite=Lax cookies.
Use HTTPS and `SIGN_COOKIE_SECURE=true` when deploying. Keep frontend and API on
the same site (Vite's `/api` proxy handles local development). List the exact
frontend origins in `SIGN_ALLOWED_ORIGINS`. Email verification and password
recovery are not implemented in this prototype.

Learning attempts store client-measured handshape scores, a held-frame count,
feedback, and server timestamps. They do not establish full-sign accuracy.
Progress is derived from saved attempts; browser guest completion is not
automatically attributed to a newly signed-in account. No camera footage or
audio is stored. Transcript text is saved only by the Save transcript action.
The dashboard lists the most recent ten attempts and uses all attempts for
its summary. The transcript list shows the latest 50 saved lectures.

Run account tests with `pip install -r requirements-dev.txt` and
`python -m pytest tests/test_accounts.py -q`. They use isolated in-memory data.

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

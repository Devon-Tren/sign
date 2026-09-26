# Contributing to sign

Thanks for wanting to help. This is an accessibility research prototype, so a few
of the rules below are unusual — please read the first section before opening a PR.

## The most important thing

**None of the bundled motion is verified ASL.** Every sign in this repo is an
illustrative placeholder composed from published phonological descriptions. The
single most valuable contribution anyone can make is telling us that a sign is
wrong — and the most harmful thing we could do is quietly promote a placeholder
to "correct" without a qualified signer saying so.

If you are a Deaf signer, an ASL linguist, or an interpreter: please use the
[Sign correction](.github/ISSUE_TEMPLATE/sign_correction.yml) issue template. You
do not need to read any code to file one, and we would rather have a two-line
note than nothing.

We will not merge a change to `validation_status` from `illustrative` to
`validated` unless a qualified Deaf signer has reviewed that specific motion and
is credited in the PR.

## Ways to contribute

| | |
|---|---|
| **Correct a sign** | Sign correction issue — no code needed |
| **Report a bug** | Bug report issue |
| **Improve the rig or rendering** | PR against `frontend/src/components/Avatar.tsx` |
| **Add a handshape or movement primitive** | PR against `frontend/src/clips.ts` |
| **Backend / API / catalog** | PR against `backend/` |
| **Docs and accessibility of the UI itself** | Always welcome |

## Licensing — read before adding data

This repository is **dual-licensed** and the boundary is load-bearing:

- **Code** (everything outside `data/`) is MIT. By contributing code you agree it
  is released under MIT.
- **`data/`** is CC BY-NC 4.0, because it derives from ASL-LEX 2.0.

If your contribution adds linguistic data — sign parameters, notation, corpora,
annotations — then:

1. **State the source and its license in the PR.** Data with no stated provenance
   will be declined, however obviously correct it is.
2. **Do not scrape sign-language dictionaries or video sites.** Those recordings
   are Deaf signers' labor and are usually copyrighted and ToS-protected.
3. **Do not add data that is more restrictive than CC BY-NC 4.0** without
   flagging it clearly — it may need to live somewhere else or be declined.
4. **Never submit video or motion capture of a person without their explicit,
   informed consent** for this use.

If you are unsure whether a source is usable, open an issue and ask before doing
the work.

## Development setup

Prerequisites: Node.js 20+, Python 3.11+.

```bash
./start.sh                  # installs deps, runs backend :8000 and frontend :5173
```

Or manually, in two terminals:

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn main:app --reload --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

No API key is needed for the sample lecture, the phrase library or the 3D avatar.
A key in `backend/.env` only enables live microphone transcription.

## Before you open a PR

```bash
cd backend  && python -m pytest -q     # must pass
cd frontend && npm run build           # must pass (this runs tsc)
```

Please also:

- **Look at the change.** If you touched the avatar, render the affected signs and
  include a screenshot. A rig change that typechecks can still be anatomically wrong.
- **Watch the frame rate.** The avatar runs alongside live transcription. Keep the
  render loop allocation-free and stay at 60fps; say so in the PR if you measured it.
- **Match the surrounding style.** The codebase is terse; don't reformat files you
  aren't otherwise changing.
- **Keep the disclaimers.** Do not remove or soften language marking motion as
  unverified. If you think a specific disclaimer is inaccurate, say so in an issue.

## Regenerating the ASL-LEX extract

```bash
python scripts/extract_asl_lex.py
```

This re-downloads the source database and rewrites `data/asl_lex_params.json`. The
source database is deliberately not vendored. To add a sign, add it to `MAPPING` in
that script and mark the fidelity honestly — `approximate` is not a failure, an
unmarked approximation is.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

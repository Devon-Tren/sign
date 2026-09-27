# Phrase-motion iteration and teammate handoff

This is the repeatable workflow for bringing a small batch of the 200 phrase-bank
entries into agreement with their ASL-LEX reference signs. It is deliberately a
batch workflow, not an instruction to change all 200 entries in one commit.

The engineering pass has two separate targets:

1. Match each avatar sign to measurable properties of its isolated reference
   video: handshape, two-dimensional hand path, body region, and one- versus
   two-handed production.
2. Play the complete connected phrase without body penetration, impossible
   joint angles, or excessive hand speed/turn rate.

A passing report means the motion satisfies these automated checks. It does not
mean that the phrase is validated ASL; the candidate gloss and connected signing
still require review by a qualified Deaf signer.

## 1. Synchronize before choosing work

Start from the repository root with a clean worktree:

```sh
git switch main
git status --short --branch
git pull --rebase origin main
```

Do not discard local changes to make the tree clean. Commit your own complete
work first, or coordinate with the person who owns the changes. Devon owns bank
rows 1-100 and the teammate owns rows 101-200, as recorded in `PHRASE_BANK.md`.
Motion and rig files are shared, so tell the teammate which signs or shared
subsystem you are changing before starting a batch.

Use a batch of one to five related failing phrases. A good batch shares a sign
or a failure type, such as torso contact, wrong number of active hands, or a
common location. Small batches make regressions and merge conflicts tractable.

## 2. Establish the current baseline

From the repository root:

```sh
npm --prefix frontend install
npm --prefix frontend run safety -- --report-only
npm --prefix frontend run phrases
```

The default phrase comparison covers rows 1-100. Use this only after the second
half has all of its local video-feature files:

```sh
npm --prefix frontend run phrases -- --all
```

Reports are written to `artifacts/safety/report.json` and
`artifacts/phrase-verify/report.json`. The entire `artifacts/` directory is
ignored by Git because it can contain licensed reference videos. Never force-add
anything from that directory.

The phrase command exits nonzero while any selected phrase fails. That is the
expected baseline, not a reason to skip reading its report. Preserve the command
output or inspect the JSON report to select a small batch.

## 3. Make sure the selected signs have reference features

`data/asl/phrase_bank_references.json` maps every gloss token to its motion,
ASL-LEX entry, reference-video player, and ASL-LEX page. Confirm that the chosen
English sense is correct before tuning motion to it. A good geometric match to
the wrong lexical sense is still wrong.

Downloaded videos and extracted features are local, ignored inputs. To prepare
one or more missing tokens, use uppercase comma-separated token names:

```sh
python3 scripts/fetch_reference_videos.py --only THANK_YOU,PLEASE
artifacts/video-env/bin/python scripts/video_features.py --only THANK_YOU,PLEASE
```

The feature extractor requires Python 3.10-3.12. Its tested local environment is:

```sh
/opt/homebrew/bin/python3.11 -m venv artifacts/video-env
artifacts/video-env/bin/pip install mediapipe==0.10.14 opencv-python-headless numpy
```

It also requires `ffmpeg` for downloading videos. `scripts/video_features.py`
downloads its pose model when needed and uses the hand model already under
`frontend/public/mediapipe/models/`.

Do not edit extracted feature JSON to make a test pass. If tracking is visibly
wrong, record that as a measurement problem and fix the extractor or obtain a
better reference rather than tuning the avatar to bad landmarks.

## 4. Reproduce only the selected batch

Always run targeted safety **before** targeted phrase verification. The phrase
verifier reads the latest safety report, and each targeted run replaces the
previous ignored report.

Phrase IDs are lowercase IDs from `phrase_bank.json`, not gloss tokens:

```sh
npm --prefix frontend run safety -- --only how-are-you,thank-you --report-only
npm --prefix frontend run phrases -- --only how-are-you,thank-you
```

Read every failure and classify it before editing:

- **Handshape:** compare finger state during the stroke with the video and the
  ASL-LEX descriptor. Check whether the error is a sign-specific handshape or a
  shared handshape-composition problem.
- **Path:** compare the ten avatar and video path samples in the phrase report.
  Determine whether the error is translation, scale, direction, or timing.
- **Region:** confirm the ASL-LEX major/minor location and visually check the
  video. Do not move a sign merely because a noisy landmark grazes a threshold.
- **Hands:** decide whether the reference truly uses the non-dominant hand or
  MediaPipe merely saw a resting hand. Then fix the motion or the measurement.
- **Safety:** inspect the named bone/body pair and worst frame. Separate a
  phrase-specific collision from the idle/rest baseline and from a shared IK
  defect.

The reference videos are isolated citation forms. They support per-sign tuning;
they do not prove phrase-level word order, transitions, or non-manual grammar.

## 5. Make the smallest evidence-backed correction

Prefer the narrowest layer that represents the real cause:

1. Correct a wrong gloss sense or phrase field in
   `data/asl/phrase_bank.json`, then regenerate references with
   `python3 scripts/resolve_phrase_bank.py`.
2. Correct an existing exact motion or sequence in
   `data/asl_authored_motions.json`.
3. Add a documented, sign-specific augmentation in
   `data/asl_custom_motions.json` when the source descriptors omit a visible
   property such as orientation, resting-hand placement, or clearance.
4. Change shared generation in `frontend/src/clips.ts` or anchors in
   `frontend/src/anchors.ts` only when several signs demonstrate the same rule.
5. Change IK/contact behavior in `frontend/src/rigPose.ts` or
   `frontend/src/signerRig.ts` only when the requested pose is correct but the
   rendered skeleton is unsafe or cannot realize it.

Keep source evidence and limitations in comments or data notes. Do not obtain a
pass by broadly loosening thresholds, hiding a safety finding, disabling a
contact, or changing unrelated signs. A shared fix must be checked against the
already-passing phrases it can affect.

## 6. Verify after each correction

First rerun the selected batch in the required order:

```sh
npm --prefix frontend run safety -- --only how-are-you,thank-you --report-only
npm --prefix frontend run phrases -- --only how-are-you,thank-you
```

Then run the motion tests and production build:

```sh
npm --prefix frontend test
npm --prefix frontend run build
```

For a sign-specific data change, also rerun nearby phrases that reuse the sign.
For a shared anchors, handshape, contact, or IK change, rerun the full current
scope before committing:

```sh
npm --prefix frontend run safety -- --report-only
npm --prefix frontend run phrases
```

Compare the new report with the baseline. The batch should pass without turning
previous passes into failures. Warnings should be understood and recorded; do
not assume that a zero exit code proves visual correctness.

## 7. Commit one reviewable batch

Inspect exactly what will be shared:

```sh
git status --short
git diff --check
git diff
```

Stage only source, test, and documentation files that belong to the batch. Do
not use `git add .`, because local reference material must remain untracked.
For example:

```sh
git add data/asl_custom_motions.json frontend/src/rigPose.ts frontend/tests/rig.test.ts
git commit -m "Correct THANK-YOU and PLEASE contact motion"
```

The commit should identify the affected sign or shared rule. Include or update a
regression test when changing reusable motion or rig behavior.

## 8. Rebase and push for the teammate

After committing, incorporate anything the teammate pushed during the batch:

```sh
git fetch origin main
git rebase origin/main
```

If the rebase changes a shared motion/rig file, rerun the targeted safety and
phrase commands plus the relevant tests. Resolve conflicts by preserving both
intentions; do not automatically choose one side of motion data.

When verification is still good:

```sh
git push origin main
git status --short --branch
git rev-list --left-right --count main...origin/main
```

The final count must be `0  0`. Send the teammate the new commit hash, the phrase
IDs/signs changed, the commands run, the new pass count, and any known warning or
unresolved reference ambiguity. The teammate should start their next batch with
`git pull --rebase origin main`.

## Definition of done for one batch

A batch is complete when:

- the exact reference sense and video were checked;
- selected phrases pass video-feature comparison and relevant safety filtering;
- no known previously passing phrase regressed;
- motion tests and the build pass;
- the diff contains no reference videos or generated artifacts;
- the commit is rebased onto current `origin/main` and pushed; and
- the teammate receives the commit hash, affected IDs, test results, and honest
  limitations.

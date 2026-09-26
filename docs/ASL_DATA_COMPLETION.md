# ASL motion data: implementation and outstanding review

Updated September 26, 2026. These changes improve procedural candidates; they
do not establish linguistic correctness. No signer approvals were added.

## Implemented

- Imported the pinned [ASL-Phono release](https://doi.org/10.5281/zenodo.5484145),
  by Cleison Correia de Amorim and Cleber Zanchettin, under CC BY 4.0.
  `scripts/extract_asl_phono.py` verifies the archive checksum and generates a
  deterministic extract from all 9,747 3D samples / 2,650 labels.
- Matched ASL-LEX **source EntryID**, not application clip names or fuzzy English
  glosses. This gives 720 matches, 133 majority orientation estimates and 40
  majority movement estimates. The earlier 718 / 134 exploratory counts used
  application IDs instead; aliases explain the difference.
- Mapped all 26 directions into `+x signer right, +y up, +z away from body`.
  The upstream [coordinate constants](https://github.com/amorim-cleison/asl-datasets-gen/blob/b16a25beffae41691655ca9f4d1469246ea87e60/constant/constants.py)
  and [palm-normal extraction](https://github.com/amorim-cleison/asl-datasets-gen/blob/b16a25beffae41691655ca9f4d1469246ea87e60/extractor/phono_extractor.py)
  establish that direction labels already account for the camera mirror.
- Kept ASL-LEX handshape, location, path family, size heuristics and non-manual
  composition intact. Source confidence and consensus are separate fields.
- Added orientation and movement priors to actual playback, not just metadata.
  **86 signs change palm orientation and 7 change movement direction.**
- Kept authored orientations and contact relations above estimates. Compounds
  and lexicalized fingerspelling do not use pooled whole-sign priors. Existing
  relocations outrank movement estimates. Only local Straight/BackAndForth
  paths use the new direction; unsupported path families retain their behavior.
- Projected finger direction into the estimated palm plane to avoid a singular
  wrist basis. Prevented heuristic ulnar rotation from rotating an estimated
  palm a second time. Fixed symmetric local travel so both wrists move.
- Corrected the audit's conflation of low wrist travel with no movement:
  **11 of the previous 66 cases change fingers or orientation; 55 remain in a
  reference-review queue.** Neither classification is a linguistic verdict.
- Preserved frequency ratings and made the top 100 exact mappings the default
  visual review queue. Start/stroke/hold captures, source evidence, optional
  prior disabling, standalone HTML export and JSON audit export are available.
- Added finite-pose checks and tests for threshold boundaries, all directions,
  precedence, compound/loan exclusions, both playback tempos and actual motion.
  Review fingerprints now include the new data plus anchors, handshapes and rig.

## What the gate means

For each channel independently, count every valid frame observation and accept
the most common label only if `2 * votes > observations`. A 50% tie is rejected.
Malformed directions, null channels, invalid scores and nonfinite values abstain.
All published frames are retained, including quantized boundary frames.

This reproduces the exploratory **frame-vote** calculation. It is not
cross-sample or independent-signer consensus: a long sample contributes more
votes, and a single sample may pass. Each record retains source sample IDs,
sample/support counts, raw vote counts, mean winning-label confidence, rejected
estimates and an archive fingerprint. A 60% majority is not a 60% probability
that the sign is correct. Different lexical variants can share a gloss.

The [ASL-Phono paper](https://arxiv.org/abs/2201.02065) describes estimated palm
normals and frame-to-frame movement at 3 fps. A single majority vector cannot
recover orientation changes, repeated movement phases or full trajectories.
The runtime therefore does not import its handshape or mouth-opening estimates.

## ASLLVD evaluation

The [BU ASLLVD description](https://www.bu.edu/asllrp/av/dai-asllvd.html)
documents human-annotated start/end handshape for both hands and richer
morpheme annotations. The flat
[2023-10-23 CSV](https://dai.cs.rutgers.edu/asllvd/signbank/asllvd_signs_2023_10_23.csv)
was inspected directly:

| Measurement | Result |
| --- | ---: |
| Samples / main glosses | 9,746 / 2,768 |
| Exact catalog source-gloss matches | 668 |
| Dominant start/end handshape differences | 2,507 |
| Non-dominant start/end differences | 1,265 |
| Rows classified as compounds | 747 |
| Orientation / morpheme columns in this flat CSV | 0 / 0 |

The richer annotation files are needed for compound alignment. Handshape labels
and lexical variants also need reconciliation before importing transitions;
blindly replacing the ASL-LEX handshape would violate this integration's scope.
ASLLVD is a useful reference source, not a complete orientation specification.
Its [terms](https://www.bu.edu/asllrp/signbank-terms.pdf) differ from ASL-Phono's
CC BY license. No ASLLVD source videos or annotation rows were vendored.
`scripts/evaluate_asllvd.py` reproduces these aggregate checks from a local CSV.

## Still outstanding

| Work | Actual status / next input |
| --- | --- |
| Author orientations for the top 100 | Ranked worksheet and rendered poses prepared; reference-based authorship is **not complete**. Existing 14 authored entries are preserved. |
| Verify 55 low-travel cases | All listed in the exported packet, with descriptors and evidence. Exact-variant reference comparison remains pending. |
| Reference-video review of the full catalog | Not completed. Numerical and browser checks are engineering verification only. |
| Deaf signer review | Pending; requires an actual reviewer, qualifications, evidence and back-translation. |
| 3D-LEX capture integration | Dataset not available in this workspace. The [maintainer repository](https://github.com/OlineRanum/SAPA#dataset) directs users to contact the authors for access. |
| Recorded size, trajectory and facial grammar | ASL-Phono does not supply a trustworthy full performance. These gaps remain. |

The 3D-LEX repository reports CC BY 4.0 and body, glove and facial capture;
it does **not** provide a public motion archive at the checked location. An
[unsent access-request draft](3D_LEX_ACCESS_REQUEST.md) is ready. Receiving the
dataset, inspecting formats and retargeting/reviewing it are separate remaining
steps; the existence of the paper is not a completed capture pipeline.

## Reproduce and inspect

```bash
python3 scripts/extract_asl_phono.py --archive /path/to/asl-phono.zip
# Without --archive, downloads the pinned 6 MB release.
npm --prefix frontend run audit
npm --prefix frontend test
backend/.venv/bin/python -m pytest backend/tests -q
npm --prefix frontend run build
mkdir -p artifacts/motion-review
python3 scripts/export_motion_review.py > artifacts/motion-review/review-packet.json
python3 scripts/evaluate_asllvd.py /path/to/asllvd_signs_2023_10_23.csv
```

Open **Motion audit**, choose a queue and capture. `Download sheet` saves a
standalone HTML artifact; `Download audit` saves the numerical report. To compare
estimates, disable ASL-Phono and recapture. Capture images are evidence of what
the renderer produces, not a sign-correctness test. Local generated artifacts
live in `artifacts/motion-review/` and are git-ignored.

Keep reviewed orientation changes in `data/asl_custom_motions.json` with their
reference evidence. Never turn an estimated prior into a purported authored or
approved entry merely to improve a coverage count. Mixed review packets retain
the ASL-LEX CC BY-NC and ASL-Phono CC BY attribution requirements.

Verification for this change: 50 backend tests and 6 frontend tests passed;
production build and catalog audit passed; rebuilding the pinned ASL-Phono
extract was byte-identical. A headless Chrome run rendered 100 signs / 300
frames with no page errors. Visual inspection caught and corrected cropped
heads and an insufficient first-pose warmup; the saved sheet was regenerated.
The restarted local API reports 1,285 motions, a consistent catalog and zero
catalog mismatches. The build still reports the existing large-bundle warning.

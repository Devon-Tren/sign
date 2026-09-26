# Translation, avatar playback, and ASL review

## Current behavior

Typed classroom messages and finalized microphone transcripts both call
`POST /api/plan` with up to five preceding messages. Captions appear immediately;
translation requests run in input order. The sample lecture is explicitly an
illustrative demo and continues to use its old clip matcher. The Library and
Tutor also remain illustrative.

Exact catalog constructions can be reused only with matching context, or when
explicitly marked context-independent. Other inputs use the two-stage LLM when
configured. Model-generated constructions remain candidates even if all their
sign IDs exist. No reviewed examples are bundled. Live signing will therefore
stay idle and preserve captions until a real reviewer approves a playable
catalog construction. This is intentional, not a network failure.

Use the separate Classroom ASL plan panel with `Hello`, `Thank you`, `Yes`, or
`No` to inspect an unapproved rehearsal. `Do you understand?` demonstrates a
blocked sequence: its addressee sign is not implemented. `Could you explain that
again?` also reports a missing reference and unavailable motions.

## Motion contract v1

The current adapter is `asl-lex-procedural-v1`. Its vocabulary consists of the
11 keys in `data/asl_lex_params.json`; these are phonological parameter-driven
approximations, not captured signing. `data/asl/catalog.json` maps stable sign IDs
to explicit `{format, clip_id}` assets. Unsupported concepts are registered with
null assets; they cannot be compiled. The artificial-intelligence fallback is
not a supported signing asset.

`playback` is returned only for an approved, complete plan. `rehearsal` is a
technically renderable candidate for explicit reviewer preview. Both use:

```json
{
  "version": 1,
  "renderer": "asl-lex-procedural-v1",
  "duration_ms": 1262,
  "clips": [{"anchor":"s1","sign_id":"HELLO","clip_id":"hello","start_ms":0,"end_ms":1262}],
  "nonmanuals": []
}
```

Times are milliseconds, with half-open `[start_ms, end_ms)` intervals. Sign
anchors are unique. An inclusive anchored expression span is compiled from the
start of its first clip through the end of its last clip. Expression controls
are brow, mouth, three head rotations, and torso rotation; numbers are bounded
between -1 and 1. Overlapping expressions are rejected until a composition
policy exists. Expressions override the underlying procedural facial/body cues.

The avatar's own elapsed animation clock advances the timeline. Pause freezes
progress; speed changes affect the remaining duration. Completion comes from
that clock, not a separate wall-clock timeout. These controls do not supply
coarticulation, classifiers, arbitrary fingerspelling, or a glTF loader. Those
require a richer renderer and separate review.

## Reviewer workflow

1. Run the app and open the Classroom ASL plan panel. Enter an example's exact
   English and context. Inspect its full plan and rendered rehearsal. Missing
   motions must be implemented before approving it.
2. Export a packet with the backend environment active:
   `python scripts/export_asl_review.py > /tmp/asl-review.json`.
3. A qualified Deaf signer reviews the exact rendered sequence, intended
   meaning, grammar, referents and expression timing. Ask another fluent viewer
   to explain what they understood without first showing the English. Record
   that back-translation and necessary corrections.
4. Record reviewer identity (with permission), qualification, date, evidence
   reference, and each assessment in the packet. Set decision to `approved`
   only when all four checks pass. Rejected/pending rows never enable playback.
5. A maintainer copies reviewed records into `data/asl/reviews.json`, retaining
   their fingerprint, and commits them with the review evidence. Do not insert
   a test approval into production. The file is not writable through the API.
6. Retest the exact message through typed input and microphone transcription.
   Compare the heard text, transcript, plan, and understood signing separately.

Approval is bound to the example, the vocabulary/profiles, procedural parameter
data, and renderer source hash. Editing any of those makes approvals stale and
returns playback to captions-only. A fingerprint binds content; it does not
verify someone's identity or professional qualifications. Maintainers must
verify the review evidence. Approval covers that exact construction, not novel
LLM-generated arrangements.

## Evaluation protocol

Use `data/asl/evaluation.json` for supported and unsupported contrasts. Track:
translation omissions (especially negation, people, quantity, before/on time),
correct rejection, reviewer comprehension, nonmanual timing, and transcript
errors separately. Unit tests cover the program's gates, not those human scores.
No linguistic accuracy or comprehension scores have been collected yet.

## Inputs still needed

- A qualified ASL reviewer, with permission to record their assessment.
- Licensed clips or corrections to the procedural motions. For a replacement
  asset pipeline, provide the avatar rig, coordinate system, units, bone names,
  facial channels, clip durations, and format (for example glTF).
- The intended classroom/demo scope and actual sentences to evaluate.

The catalog's references use the repository's existing ASL-LEX data. Its
CC BY-NC 4.0 attribution and limits remain in `data/LICENSE` and `NOTICE`; no
external recordings have been copied or downloaded for this change.

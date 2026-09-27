# Phrase bank: 200 common ASL phrases

`data/asl/phrase_bank.json` holds the 200 everyday phrases we are tuning the
avatar to sign correctly. Each phrase is an English sentence plus a candidate
ASL gloss. Every sign in a gloss links to a real reference video of a Deaf
signer, and the safety audit checks that the avatar can play the phrase without
breaking a joint or pushing a hand through its own body.

## Who owns what

| Phrases | Owner | Groups |
|---|---|---|
| 1–100 (first 100 lines of `phrases`) | Devon | greetings, introductions, wellbeing, understanding, responses, first half of questions |
| 101–200 (last 100 lines) | teammate | rest of questions, needs, food, family, time, school_work, places, emergency |

Each phrase is on its own line, so you can both edit the file without merge
conflicts. Only edit your own half.

## Your job on phrases 101–200

For each phrase:

1. **Check the gloss against the reference videos.** Open
   `data/asl/phrase_bank_references.json`, find each sign under `signs`, and
   open its `asl_lex_page` in a browser. The page plays ASL-LEX's video of a
   Deaf signer doing that sign. Confirm:
   - it is the right sign for this sentence (not a different sense of the same
     English word: RIGHT as in "turn right" is not RIGHT as in "correct");
   - the word order reads like ASL, not English. Topic first, question word
     last (`BATHROOM WHERE`, not `WHERE BATHROOM`), no signs for "is", "the"
     or "to".
2. **Fix the gloss if needed.** Tokens are catalog sign ids in upper case
   (`THANK_YOU` plays the `thank_you` motion). `FS:WORD` is fingerspelled. If
   ASL-LEX has several senses of a word (`right_1`, `right_2`), pin the right
   one in `lex_senses` at the top of the file.
3. **Check the facial grammar field.** `question_type: "wh"` (brows down) for
   who/what/where/when/why/how questions, `"yes_no"` (brows up) for yes/no
   questions, and `negated: true` (headshake) for negation. Each needs the
   matching `profile`, as in the existing lines.
4. **Write down anything you're unsure of.** Add a `"note"` field to the
   phrase and leave it for a fluent signer to check. Don't guess silently.

Then regenerate the references and check coverage:

```
python scripts/resolve_phrase_bank.py
```

It prints how many phrases can be played now, and lists any sign that has no
motion or no reference video yet. Commit `phrase_bank.json` and the
regenerated `phrase_bank_references.json` together.

## Checking the avatar can sign it safely

```
cd frontend && npm run safety -- --report-only
cd frontend && npm run safety -- --only where-is-the-bathroom,thank_you
```

This plays every phrase at 60 frames per second, transitions included, and
checks every frame for:

- joints bent past human range: elbow, shoulder, forearm twist, wrist, fingers;
- hands, fingers or forearms going into the head, neck, torso, or the other
  arm or hand, measured against the avatar's real mesh;
- the hand moving or turning impossibly fast.

Results go to `artifacts/safety/report.json`: every item, with the worst
frame of each problem and whether it is a warning or a failure. Without
`--report-only` the command exits 1 when anything fails.

## Reference data: never commit it

- **ASL-LEX videos** (the `reference_video` links) are CC BY-NC 4.0. Stream
  them in a browser. If you download them for analysis, keep them in
  `artifacts/`, which git ignores.
- **SignAvatars** (ECCV 2024, 3D SMPL-X motion for word-level ASL and
  How2Sign sentences) was licensed to Devon for non-commercial research. This
  repo is public: do not commit the data, the download links, or anything
  converted from it. Ask Devon for the local copy, or request your own access at
  https://github.com/ZhengdiYu/SignAvatars. It lives outside the repo in
  `~/Downloads/signavatars/`.

## Status of the glosses

The glosses were written as candidates by a non-signer and are marked
`"status": "candidate"`. Passing the safety audit and matching the reference
video still doesn't make a phrase correct ASL. Before anything is presented as
correct signing, a fluent Deaf signer has to review it.

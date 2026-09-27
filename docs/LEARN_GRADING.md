# Learn practice grading

Each of the 14 learning items has an explicit ordered rubric in `frontend/src/practiceGrading.ts`. The same rubric supplies the visible instructions. Changing an avatar motion should include reviewing its matching rubric.

The three single-hand foundations require a stable 1.2-second hold. Hello accepts a continuous salute with at least two distinct samples over 80 ms per phase, relaxed straight fingers, and an oblique outward palm; it does not require a stationary hold. Other steps require at least three distinct sampled camera frames, with 140–220 ms dwell time. Two-hand coordination also requires a 1.2-second hold. Both hands must be visible and satisfy their own conditions for two-hand items.

Full credit and completion require every step in order. A timeout records only the completed steps (below 90%), never a peak frame. Duplicate camera frames are not processed. Missing/uncertain tracking stops hold accumulation; prolonged loss, tracker jumps, or an expired step clear sequence progress. Each attempt has a 12-second limit and starts fresh. Signing handedness stays fixed during an attempt. Old `sign-drill-completion-v1` badges do not count toward the new version.

| Item | Required evidence |
| --- | --- |
| Open hand | Four fingers straight, palm forward, stable hold |
| Closed hand | Four fingers curled, palm forward, stable hold |
| Index extension | Index straight, other fingers curled, stable hold |
| Two-hand coordination | Both palms open, above shoulders and outward, stable hold |
| Hello | Relaxed open hand near brow, then outward or upward-diagonal travel; a stationary or chest-level wave does not pass |
| Thank you | Open fingertips at chin, palm inward, then downward travel |
| Please | Flat inward-facing palm at chest, ordered circular path |
| Name | Both H hands, approximately perpendicular, two approach/separation cycles |
| Me | Index near chest, then inward point toward chest |
| You | Index preparation, then point toward camera |
| Help | Thumb-up fist above upward support palm, two taps |
| Again | Curved fingers above upward support palm, two fingertip approaches |
| Understand | Fist/index changes twice near head, inward palm, slight nod |
| Question | Raised index, two curls/extensions beside head, forward palm |

Hand joint angles and palm orientation use MediaPipe world landmarks; head/chest positions use visible pose landmarks normalized by shoulder width. Right and left signing hands are supported. This follows the output coordinate definitions in [Google's hand documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) and [pose documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

## Limits and validation

This is a rule-based practice checker, not trained ASL recognition. A score is completion of the measured steps, not confidence in an ASL translation. A single camera cannot confirm actual physical contact, facial expression, or fluency. Occlusion and depth estimation may reject a correct performance; thresholds still need tuning with consenting human learners. Synthetic positive and adversarial tests exercise all rubrics, missing steps, unrelated gestures, timing, lost tracking, handedness, and malformed landmarks. They do not establish real-world recognition accuracy.

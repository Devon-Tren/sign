#!/usr/bin/env python3
"""Measure the reference videos with MediaPipe, in the same terms as the avatar.

Setup (MediaPipe has no wheel for Python 3.14; any 3.10-3.12 works):

    /opt/homebrew/bin/python3.11 -m venv artifacts/video-env
    artifacts/video-env/bin/pip install mediapipe==0.10.14 opencv-python-headless numpy
    (1.0.x aborts with "Service is unavailable" on macOS; 0.10.14 works.)
    python3 scripts/fetch_reference_videos.py --first 100
    artifacts/video-env/bin/python scripts/video_features.py [--only THANK_YOU]

Reads artifacts/reference-videos/<TOKEN>.mp4 and writes
artifacts/reference-videos/features/<TOKEN>.json, which
frontend/tests/phraseVerify.ts compares against the avatar.

BODY FRAME, shared with the avatar: origin at the shoulder midpoint, one unit =
shoulder width, +x toward the signer's dominant (right) shoulder, +y up. The
video is a single front camera, so only x and y are measured; depth is not
trusted. The signer faces the camera, so her right hand is on the image left.

Only the stroke is measured: ASL-LEX codes where each sign starts and ends in
its clip (SignOnset/SignOffset), so the lead-in from rest is excluded.
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

ROOT = Path(__file__).resolve().parents[1]
VIDEOS = ROOT / 'artifacts/reference-videos'
MODELS = VIDEOS / 'models'
FEATURES = VIDEOS / 'features'
REFS = ROOT / 'data/asl/phrase_bank_references.json'
PROPS = VIDEOS / 'sign_props.json'
PROPS_URL = 'https://asl-lex.org/visualization/data/sign_props.json'
HAND_MODEL = ROOT / 'frontend/public/mediapipe/models/hand_landmarker.task'
POSE_MODEL = MODELS / 'pose_landmarker_full.task'
POSE_URL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
            'pose_landmarker_full/float16/latest/pose_landmarker_full.task')

# MediaPipe hand landmarks: 0 wrist; (MCP, PIP, DIP, TIP) per finger.
FINGERS = {'index': (5, 6, 7, 8), 'middle': (9, 10, 11, 12), 'ring': (13, 14, 15, 16), 'pinky': (17, 18, 19, 20)}
PALM = (0, 5, 9, 13, 17)
# Pose landmarks.
NOSE, MOUTH_L, MOUTH_R, L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST, L_HIP, R_HIP = 0, 9, 10, 11, 12, 15, 16, 23, 24
PHASES = 10


def angle(a, b, c) -> float:
    """Bend at b, in degrees: 0 = straight."""
    u, v = np.subtract(b, a), np.subtract(c, b)
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-9 or nv < 1e-9:
        return float('nan')
    return math.degrees(math.acos(float(np.clip(np.dot(u, v) / (nu * nv), -1, 1))))


def flexion(world) -> dict:
    """MCP and PIP bend per finger, from the metric 3D hand landmarks. The
    avatar exposes the same two joints (its fingertip is extrapolated)."""
    return {name: {'mcp': angle(world[0], world[m], world[p]), 'pip': angle(world[m], world[p], world[d])}
            for name, (m, p, d, _) in FINGERS.items()}


def load_props() -> dict:
    if not PROPS.exists():
        PROPS.write_bytes(urllib.request.urlopen(PROPS_URL, timeout=180).read())
    return {p['EntryID']: p for p in json.loads(PROPS.read_text())}


def number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def measure(path: Path, hands, pose) -> dict:
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 29.97
    frames, index = [], 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        stamp = int(index * 1000 / fps)
        h, w = rgb.shape[:2]
        p = pose.detect_for_video(image, stamp)
        hr = hands.detect_for_video(image, stamp)
        frame = {'ms': stamp, 'pose': None, 'hands': []}
        if p.pose_landmarks:
            frame['pose'] = [(lm.x * w, lm.y * h, lm.visibility) for lm in p.pose_landmarks[0]]
        for lms, world, handed in zip(hr.hand_landmarks, hr.hand_world_landmarks, hr.handedness):
            frame['hands'].append({'image': [(lm.x * w, lm.y * h) for lm in lms],
                                   'world': [(lm.x, lm.y, lm.z) for lm in world],
                                   'label': handed[0].category_name, 'score': handed[0].score})
        frames.append(frame)
        index += 1
    cap.release()
    return {'fps': fps, 'frames': frames}


def to_body(frame) -> tuple | None:
    """Body frame from this frame's shoulders: origin, x axis (toward the
    signer's right shoulder, i.e. image left), unit length."""
    pose = frame['pose']
    if not pose or min(pose[L_SHOULDER][2], pose[R_SHOULDER][2]) < 0.5:
        return None
    right, left = np.array(pose[R_SHOULDER][:2]), np.array(pose[L_SHOULDER][:2])
    origin = (right + left) / 2
    width = float(np.linalg.norm(right - left))
    if width < 1:
        return None
    x = (right - left) / width
    y = np.array([x[1], -x[0]])  # image y points down; +y is up
    if y[1] > 0:
        y = -y
    return origin, x, y, width


def body_point(point, frame_body) -> list[float]:
    origin, x, y, width = frame_body
    d = np.array(point[:2]) - origin
    return [float(d @ x) / width, float(d @ y) / width]


def assign_hands(frame, body) -> dict:
    """Signer's right (dominant) and left hand: each detected hand goes to the
    nearer pose wrist. The pose model keeps track of which wrist is which
    through crossings and clasps (CONGRATULATIONS put the right hand on the
    left by image side), where hand labels and image sides both fail."""
    pose = frame['pose']
    wrists = {'right': np.array(pose[R_WRIST][:2]), 'left': np.array(pose[L_WRIST][:2])}
    pairs = sorted((float(np.linalg.norm(np.array(hand['image'][0]) - wrists[side])), side, i)
                   for i, hand in enumerate(frame['hands']) for side in wrists)
    out, used = {}, set()
    for _, side, i in pairs:
        if side not in out and i not in used:
            out[side] = frame['hands'][i]
            used.add(i)
    return out


def summarise(token: str, raw: dict, row: dict) -> dict:
    fps, frames = raw['fps'], raw['frames']
    onset, offset = number(row.get('SignOnset(ms)')), number(row.get('SignOffset(ms)'))
    clip_ms = frames[-1]['ms'] if frames else 0
    start = onset if onset is not None else 0
    end = offset if offset is not None and offset > start else clip_ms
    stroke = [f for f in frames if start <= f['ms'] <= end]
    tracks = {'right': [], 'left': []}
    rest_y, left_wrist = [], []
    for frame in stroke:
        body = to_body(frame)
        if not body:
            continue
        pose = frame['pose']
        hips = [pose[L_HIP], pose[R_HIP]]
        if min(h[2] for h in hips) > 0.3:
            rest_y.append(body_point(np.mean([h[:2] for h in hips], axis=0), body)[1])
        nose = body_point(pose[NOSE], body)
        if pose[L_WRIST][2] > 0.3:
            left_wrist.append(body_point(pose[L_WRIST], body)[1])
        mouth = body_point(np.mean([pose[MOUTH_L][:2], pose[MOUTH_R][:2]], axis=0), body)
        assigned = assign_hands(frame, body)
        if 'right' not in assigned and pose[R_WRIST][2] > 0.5:
            # Clasped or overlapping hands detect as one hand, which goes to
            # the other wrist (CONGRATULATIONS). Keep the signing hand's path
            # from the pose wrist; its handshape is unknown for this frame.
            w = body_point(pose[R_WRIST], body)
            tracks['right'].append({'ms': frame['ms'], 'centre': w, 'index_tip': w, 'nose': nose, 'mouth': mouth,
                                    'flex': None})
        for side, hand in assigned.items():
            centre = np.mean([hand['image'][i] for i in PALM], axis=0)
            tip = hand['image'][8]
            tracks[side].append({'ms': frame['ms'], 'centre': body_point(centre, body),
                                 'index_tip': body_point(tip, body), 'nose': nose, 'mouth': mouth,
                                 'flex': flexion(hand['world'])})
    duration = max(1.0, end - start)

    def path(track, key='centre'):
        if len(track) < 3:
            return None
        times = np.array([(p['ms'] - start) / duration for p in track])
        pts = np.array([p[key] for p in track])
        grid = np.linspace(0.05, 0.95, PHASES)
        return [[float(np.interp(g, times, pts[:, k])) for k in range(2)] for g in grid]

    def mid_flex(track):
        mid = [p for p in track if 0.25 <= (p['ms'] - start) / duration <= 0.75] or track
        if not mid:
            return None
        mid = [p for p in mid if p['flex']]
        if not mid:
            return None
        return {f: {j: float(np.nanmedian([p['flex'][f][j] for p in mid])) for j in ('mcp', 'pip')} for f in FINGERS}

    def region(track):
        """Where the hand works: the highest of fingertip and palm centre,
        against the mouth. A fingertip at the chin (THANK-YOU) is at the head
        even though the palm centre is a hand-length lower."""
        if not track:
            return None
        mid = [p for p in track if 0.1 <= (p['ms'] - start) / duration <= 0.9] or track
        top = float(np.percentile([max(p['index_tip'][1], p['centre'][1]) for p in mid], 80))
        mouth_y = float(np.median([p['mouth'][1] for p in mid]))
        return 'head' if top > mouth_y - 0.3 else 'torso' if top > -1.3 else 'low'

    right, left = tracks['right'], tracks['left']
    # Hips out of frame (many clips are cropped at the waist): use the typical
    # hip height of the clips where they are visible (-1.27 to -1.51).
    rest = float(np.median(rest_y)) if rest_y else -1.35
    # A second tracked hand is the reliable one/two-hand signal. The pose
    # model's left/right wrist labels swap on several mirrored ASL-LEX clips:
    # it marked the active dominant hand as "left" on one-handed HEARING,
    # THAT and NO, while missing the low support hand on two-handed WHAT.
    # Hand assignment already matches detections to both pose wrists globally,
    # so require a sustained second hand track. Overlapping-contact clips may
    # still need a descriptor-backed exception in the verifier.
    left_coverage = len(left) / max(1, len(stroke))
    # A compound may use the support hand for only one morpheme. HOMEWORK's
    # citation video visibly changes from one-handed HOME to two-handed WORK,
    # so a whole-clip majority rule incorrectly calls the compound one-handed.
    morphemes = number(row.get('NumberOfMorphemes.2.0')) or number(row.get('NumberOfMorphemes')) or 1
    left_active = left_coverage > 0.5 or (morphemes > 1 and left_coverage > 0.25)
    return {
        'token': token, 'fps': fps, 'stroke_ms': [start, end], 'frames': len(stroke),
        'detected': {'right': len(right) / max(1, len(stroke)), 'left': len(left) / max(1, len(stroke))},
        'face': {'mouth_y': float(np.median([p['mouth'][1] for p in right + left])) if right or left else None,
                 'nose_y': float(np.median([p['nose'][1] for p in right + left])) if right or left else None},
        'right': {'path': path(right), 'tip_path': path(right, 'index_tip'), 'flex': mid_flex(right), 'region': region(right)},
        'left': {'path': path(left), 'tip_path': path(left, 'index_tip'), 'flex': mid_flex(left), 'region': region(left),
                 'active': bool(left_active), 'wrist_y': float(np.median(left_wrist)) if left_wrist else None, 'rest_y': rest},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--only', help='comma-separated tokens')
    args = parser.parse_args()
    MODELS.mkdir(parents=True, exist_ok=True)
    FEATURES.mkdir(parents=True, exist_ok=True)
    if not POSE_MODEL.exists():
        POSE_MODEL.write_bytes(urllib.request.urlopen(POSE_URL, timeout=180).read())
    refs = json.loads(REFS.read_text())['signs']
    props = load_props()
    tokens = args.only.split(',') if args.only else sorted(p.stem for p in VIDEOS.glob('*.mp4'))
    for token in tokens:
        video = VIDEOS / f'{token}.mp4'
        if not video.exists():
            print(f'  {token}: no video (run fetch_reference_videos.py)')
            continue
        hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(HAND_MODEL), delegate=BaseOptions.Delegate.CPU), running_mode=vision.RunningMode.VIDEO,
            num_hands=2, min_hand_detection_confidence=0.4, min_tracking_confidence=0.4))
        pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(POSE_MODEL), delegate=BaseOptions.Delegate.CPU), running_mode=vision.RunningMode.VIDEO))
        raw = measure(video, hands, pose)
        hands.close(); pose.close()
        entry = refs.get(token, {}).get('asl_lex_entry')
        summary = summarise(token, raw, props.get(entry, {}))
        (FEATURES / f'{token}.json').write_text(json.dumps(summary, indent=1))
        d = summary['detected']
        print(f"  {token:16} stroke {summary['stroke_ms'][0]:.0f}-{summary['stroke_ms'][1]:.0f}ms  "
              f"right {d['right']:.0%} left {d['left']:.0%}  region {summary['right']['region']}  "
              f"two-handed {summary['left']['active']}")


if __name__ == '__main__':
    main()

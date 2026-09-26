"""Sign hackathon API and secure (server-side) realtime transcription bridge."""
from __future__ import annotations
import asyncio
import base64
from collections import deque
import json
import logging
import os
from array import array
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic
import sys

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from websockets.asyncio.client import connect as ws_connect

from db import get_connection, get_phrases, init_db
from interpreter import interpret
from planner import PlanRequest, create_plan

load_dotenv(Path(__file__).parent / '.env')
logging.basicConfig(level=logging.INFO)
log = logging.getLogger('sign')

@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = get_connection()
    init_db(conn)
    app.state.db = conn
    yield
    conn.close()

app = FastAPI(title='Sign API', version='0.1.0', lifespan=lifespan)
origins = [x.strip() for x in os.getenv('SIGN_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

class InterpretationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=3000)

class FeedbackRequest(BaseModel):
    drill_name: str = Field(max_length=100)
    observed: str = Field(max_length=300)
    expected: str = Field(max_length=300)
    score: int = Field(ge=0, le=100)

@app.get('/api/health')
async def health():
    return {'status': 'ok', 'project': 'sign',
            'live_configured': bool(os.getenv('OPENAI_API_KEY', '').strip()),
            'transcription_model': os.getenv('OPENAI_TRANSCRIBE_MODEL', 'gpt-live-transcribe')}

@app.get('/api/phrases')
async def phrases():
    return get_phrases(app.state.db)

@app.post('/api/interpret')
async def interpret_endpoint(body: InterpretationRequest):
    return await interpret(body.text, get_phrases(app.state.db))

@app.post('/api/plan')
async def plan_endpoint(body: PlanRequest):
    return await create_plan(body)

@app.post('/api/feedback')
async def feedback(body: FeedbackRequest):
    """Never send camera frames or personal identifiers to a language model."""
    default = f'Observed: {body.observed}. Target: {body.expected}. Adjust one finger at a time and retry.'
    key = os.getenv('OPENAI_API_KEY', '').strip()
    if not key:
        return {'feedback': default, 'mode': 'deterministic'}
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key, timeout=10, max_retries=0)
        response = await client.chat.completions.create(
            model=os.getenv('OPENAI_TEXT_MODEL', 'gpt-4.1'),
            temperature=0.2,
            max_tokens=120,
            messages=[
                {'role': 'system', 'content': 'Write one concise actionable coaching sentence about basic handshape practice. Explain only the given measured finger states, not ASL correctness. No invented observations or sign-language fluency claims.'},
                {'role': 'user', 'content': body.model_dump_json()},
            ],
        )
        return {'feedback': response.choices[0].message.content or default, 'mode': 'ai'}
    except Exception:
        return {'feedback': default, 'mode': 'fallback'}


def pcm_rms(chunk: bytes) -> float:
    """Normalized 16-bit PCM RMS. Avoids removed audioop module in Python 3.13."""
    if not chunk or len(chunk) % 2:
        return 0.0
    samples = array('h')
    samples.frombytes(chunk)
    if sys.byteorder != 'little':
        samples.byteswap()
    return (sum(x*x for x in samples) / max(1, len(samples))) ** .5 / 32768

@app.websocket('/ws/live')
async def live_audio(websocket: WebSocket):
    # CORS middleware doesn't protect WebSockets; enforce allowed browser origins.
    origin = websocket.headers.get('origin')
    if origin and origin not in origins:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    key = os.getenv('OPENAI_API_KEY', '').strip()
    if not key:
        await websocket.send_json({'type': 'error', 'message': 'Set OPENAI_API_KEY in backend/.env, then restart the backend.'})
        await websocket.close(code=1008)
        return

    model = os.getenv('OPENAI_TRANSCRIBE_MODEL', 'gpt-live-transcribe')
    upstream_url = f'wss://api.openai.com/v1/realtime?model={model}'
    current_deltas: dict[str, str] = {}
    speech_started = False
    speech_start = 0.0
    last_loud = 0.0
    received_since_commit = False
    pre_roll = deque(maxlen=5)  # Keep 0.5s of pre-speech audio; discard long idle silence.

    async def send_json_safe(payload: dict):
        try:
            await websocket.send_json(payload)
        except (RuntimeError, WebSocketDisconnect):
            pass

    try:
        async with ws_connect(upstream_url, additional_headers={
            'Authorization': f'Bearer {key}', 'OpenAI-Beta': 'realtime=v1',
        }, open_timeout=15, max_size=6_000_000) as upstream:
            await upstream.send(json.dumps({
                'type': 'session.update',
                'session': {'type': 'transcription', 'audio': {'input': {
                    'format': {'type': 'audio/pcm', 'rate': 24000},
                    'transcription': {'model': model, 'languages': ['en'], 'delay': 'low'},
                    'turn_detection': None,
                }}},
            }))
            await send_json_safe({'type': 'connected', 'model': model})

            async def receive_upstream():
                async for raw in upstream:
                    try:
                        event = json.loads(raw)
                    except (ValueError, TypeError):
                        continue
                    kind = event.get('type')
                    if kind == 'conversation.item.input_audio_transcription.delta':
                        item = event.get('item_id', 'current')
                        current_deltas[item] = current_deltas.get(item, '') + event.get('delta', '')
                        await send_json_safe({'type': 'partial', 'item_id': item, 'text': current_deltas[item]})
                    elif kind == 'conversation.item.input_audio_transcription.completed':
                        item = event.get('item_id', 'current')
                        text = event.get('transcript', '').strip()
                        current_deltas.pop(item, None)
                        if text:
                            await send_json_safe({'type': 'final', 'item_id': item, 'text': text})
                    elif kind == 'error':
                        await send_json_safe({'type': 'error', 'message': event.get('error', {}).get('message', 'Realtime transcription error')})

            upstream_task = asyncio.create_task(receive_upstream())
            try:
                while True:
                    msg = await websocket.receive()
                    if msg['type'] == 'websocket.disconnect':
                        break
                    raw = msg.get('bytes')
                    if raw:
                        if len(raw) % 2 or len(raw) > 96_000:
                            continue
                        now = monotonic()
                        loud = pcm_rms(raw) > .012
                        if loud and not speech_started:
                            speech_started = True
                            speech_start = now
                            last_loud = now
                            # Include the preceding 0.5s so first syllables aren't cut off.
                            for old in pre_roll:
                                await upstream.send(json.dumps({'type': 'input_audio_buffer.append', 'audio': base64.b64encode(old).decode('ascii')}))
                            pre_roll.clear()
                        if loud:
                            last_loud = now
                        if speech_started:
                            await upstream.send(json.dumps({'type': 'input_audio_buffer.append', 'audio': base64.b64encode(raw).decode('ascii')}))
                            received_since_commit = True
                            # Pauses finalize phrases; very long uninterrupted speech is chunked.
                            if ((now - last_loud > 1.05 and now - speech_start > .35)
                                or (now - speech_start > 7.0)):
                                await upstream.send(json.dumps({'type': 'input_audio_buffer.commit'}))
                                received_since_commit = False
                                speech_started = False
                        else:
                            pre_roll.append(raw)
                    elif msg.get('text'):
                        try:
                            control = json.loads(msg['text'])
                        except ValueError:
                            continue
                        if control.get('type') == 'flush' and received_since_commit:
                            await upstream.send(json.dumps({'type': 'input_audio_buffer.commit'}))
                            received_since_commit = False
                            speech_started = False
                            pre_roll.clear()
            finally:
                if received_since_commit:
                    await upstream.send(json.dumps({'type': 'input_audio_buffer.commit'}))
                    await asyncio.sleep(.5)
                upstream_task.cancel()
                await asyncio.gather(upstream_task, return_exceptions=True)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning('Live upstream failed: %s', str(exc))
        await send_json_safe({'type': 'error', 'message': 'Live upstream connection failed. Check your API key, model access and backend logs.'})
        try:
            await websocket.close()
        except RuntimeError:
            pass

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor Local de LectorVoz Pro con Soporte de Voces Neuronales de edge-tts.
Sirve los archivos estáticos de la aplicación web y proporciona endpoints
para síntesis en tiempo real y descarga de audios con los 22 acentos en español.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import edge_tts
except ImportError:
    edge_tts = None
    print("[AVISO] edge_tts no está instalado. Ejecute: pip install edge-tts")

import math
import subprocess
import tempfile
import numpy as np

try:
    from scipy.io import wavfile
    from scipy.fft import dct
    from sklearn.cluster import KMeans, AgglomerativeClustering
    from sklearn.preprocessing import StandardScaler
    has_diarization_deps = True
except ImportError:
    has_diarization_deps = False

try:
    from faster_whisper import WhisperModel
    has_faster_whisper = True
except ImportError:
    has_faster_whisper = False

try:
    import whisper
    has_whisper = True
except ImportError:
    has_whisper = False

PORT = 8080
DIRECTORY = Path(__file__).resolve().parent

_CACHED_FW_MODEL = None


def get_faster_whisper_model(model_size: str = "base"):
    global _CACHED_FW_MODEL
    if _CACHED_FW_MODEL is None and has_faster_whisper:
        try:
            print(f"[IA] Cargando motor de transcripción faster-whisper ({model_size})...")
            _CACHED_FW_MODEL = WhisperModel(model_size, device="cpu", compute_type="int8")
            print("[IA] Motor faster-whisper listo.")
        except Exception as e:
            print(f"[ERROR] Error cargando faster-whisper: {e}")
            _CACHED_FW_MODEL = None
    return _CACHED_FW_MODEL


class OfflineAudioDiarizer:
    """Extrae características acústicas MFCC y agrupa por hablante."""

    @staticmethod
    def extract_mfcc(signal, sr=16000, num_cep=13, nfft=512):
        if len(signal) < nfft:
            signal = np.pad(signal, (0, nfft - len(signal)))
        
        frame_len = int(0.025 * sr)
        frame_step = int(0.010 * sr)
        signal_len = len(signal)
        
        if signal_len < frame_len:
            frames = np.array([np.pad(signal, (0, frame_len - signal_len))])
        else:
            num_frames = 1 + int(math.floor((signal_len - frame_len) / frame_step))
            frames = np.zeros((num_frames, frame_len))
            for i in range(num_frames):
                frames[i] = signal[i * frame_step : i * frame_step + frame_len]
        
        frames *= np.hamming(frame_len)
        mag_frames = np.abs(np.fft.rfft(frames, nfft))
        pow_frames = (1.0 / nfft) * (mag_frames ** 2)
        
        low_freq_mel = 0
        high_freq_mel = 2595 * np.log10(1 + (sr / 2) / 700)
        mel_points = np.linspace(low_freq_mel, high_freq_mel, 26)
        hz_points = 700 * (10 ** (mel_points / 2595) - 1)
        bin_points = np.floor((nfft + 1) * hz_points / sr).astype(int)
        
        fbank = np.zeros((20, int(nfft / 2 + 1)))
        for m in range(1, 21):
            f_m_minus = bin_points[m - 1]
            f_m = bin_points[m]
            f_m_plus = bin_points[m + 1]
            for k in range(f_m_minus, f_m):
                fbank[m - 1, k] = (k - bin_points[m - 1]) / (f_m - bin_points[m - 1])
            for k in range(f_m, f_m_plus):
                fbank[m - 1, k] = (bin_points[m + 1] - k) / (bin_points[m + 1] - f_m)
                
        filter_banks = np.dot(pow_frames, fbank.T)
        filter_banks = np.where(filter_banks == 0, np.finfo(float).eps, filter_banks)
        filter_banks = 20 * np.log10(filter_banks)
        
        mfcc_feat = dct(filter_banks, type=2, axis=1, norm='ortho')[:, :num_cep]
        return np.mean(mfcc_feat, axis=0)

    @classmethod
    def process_diarization(cls, audio_wav_path, segments, num_speakers=2):
        if not segments or not has_diarization_deps:
            for seg in segments:
                seg['speaker'] = "Hablante 1"
            return segments

        try:
            sr, audio_data = wavfile.read(audio_wav_path)
            if audio_data.ndim > 1:
                audio_data = audio_data.mean(axis=1)
            audio_data = audio_data.astype(np.float32)
            max_val = np.max(np.abs(audio_data))
            if max_val > 0:
                audio_data /= max_val

            features = []
            valid_indices = []

            for idx, seg in enumerate(segments):
                start_sample = int(seg['start'] * sr)
                end_sample = int(seg['end'] * sr)
                if start_sample >= len(audio_data):
                    continue
                end_sample = min(end_sample, len(audio_data))
                segment_audio = audio_data[start_sample:end_sample]
                if len(segment_audio) < int(0.1 * sr):
                    continue
                feat = cls.extract_mfcc(segment_audio, sr=sr)
                features.append(feat)
                valid_indices.append(idx)

            if len(features) < num_speakers:
                for seg in segments:
                    seg['speaker'] = "Hablante 1"
                return segments

            X = np.array(features)
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            if len(features) >= 4:
                clustering = AgglomerativeClustering(n_clusters=num_speakers)
            else:
                clustering = KMeans(n_clusters=num_speakers, random_state=42, n_init=10)
            
            labels = clustering.fit_predict(X_scaled)
            speaker_map = {lbl: f"Hablante {lbl + 1}" for lbl in set(labels)}

            for idx, label_idx in zip(valid_indices, labels):
                segments[idx]['speaker'] = speaker_map[label_idx]

            current_spk = "Hablante 1"
            for seg in segments:
                if 'speaker' not in seg:
                    seg['speaker'] = current_spk
                else:
                    current_spk = seg['speaker']

        except Exception as e:
            print(f"[AVISO] Diarización acústica omitida: {e}")
            for seg in segments:
                seg['speaker'] = "Hablante 1"

        return segments


def format_seconds(seconds: float) -> str:
    total_secs = int(round(seconds))
    hrs = total_secs // 3600
    mins = (total_secs % 3600) // 60
    secs = total_secs % 60
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def stream_transcribe_audio_bytes(audio_bytes: bytes, filename: str = "", language: str = "es", diarize: bool = True, timestamps: bool = True, model_size: str = "base"):
    """
    Generador que convierte audio con ffmpeg y transcribe en tiempo real
    utilizando faster-whisper (o whisper), emitiendo progreso real (%) y segmentos en vivo.
    """
    if not (has_faster_whisper or has_whisper):
        raise RuntimeError("No se encontró faster-whisper ni openai-whisper en el entorno Python.")

    ext = Path(filename).suffix if filename else ".mp3"
    if not ext:
        ext = ".mp3"

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f_in:
        f_in.write(audio_bytes)
        temp_input_path = f_in.name

    temp_wav_path = temp_input_path + "_16k.wav"

    try:
        # 1. Notificar inicio de conversión
        yield {
            "type": "status",
            "progress": 2,
            "message": "Preparando y optimizando audio con FFmpeg...",
            "current_time": "00:00",
            "total_time": "--:--"
        }

        # Convertir a WAV mono 16kHz
        cmd = ["ffmpeg", "-y", "-i", temp_input_path, "-ac", "1", "-ar", "16000", "-vn", temp_wav_path]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            raise RuntimeError(f"Error convirtiendo audio con FFmpeg: {proc.stderr.decode('utf-8', errors='ignore')}")

        lang_code = language.split("-")[0].lower() if language else "es"
        if lang_code in ("auto", ""):
            lang_code = None

        segments_raw = []
        full_text_blocks = []

        if has_faster_whisper:
            model = get_faster_whisper_model(model_size)
            if model is None:
                raise RuntimeError("No fue posible inicializar el modelo faster-whisper.")

            segments_iter, info = model.transcribe(
                temp_wav_path,
                language=lang_code,
                beam_size=5,
                word_timestamps=False
            )
            total_duration = info.duration if info and info.duration > 0 else 1.0
            total_time_str = format_seconds(total_duration)

            yield {
                "type": "status",
                "progress": 4,
                "message": f"Iniciando transcripción con Whisper IA (Duración total: {total_time_str})...",
                "current_time": "00:00",
                "total_time": total_time_str
            }

            for seg in segments_iter:
                txt = seg.text.strip()
                if not txt:
                    continue

                segments_raw.append({
                    "start": seg.start,
                    "end": seg.end,
                    "text": txt
                })

                ts_str = f"[{format_seconds(seg.start)}] " if timestamps else ""
                formatted_segment_text = f"{ts_str}{txt}"
                full_text_blocks.append(formatted_segment_text)

                pct = int(min(98, max(4, (seg.end / total_duration) * 100)))
                current_time_str = format_seconds(seg.end)
                current_full_text = "\n\n".join(full_text_blocks)
                word_count = len(current_full_text.split())

                yield {
                    "type": "segment",
                    "progress": pct,
                    "current_time": current_time_str,
                    "total_time": total_time_str,
                    "segment_text": formatted_segment_text,
                    "full_text": current_full_text,
                    "word_count": word_count,
                    "start": seg.start,
                    "end": seg.end
                }

        else:
            model = whisper.load_model(model_size)
            result = model.transcribe(temp_wav_path, language=lang_code)
            segs = result.get("segments", [])
            total_duration = segs[-1]["end"] if segs else 1.0
            total_time_str = format_seconds(total_duration)

            for seg in segs:
                txt = seg.get("text", "").strip()
                if not txt:
                    continue
                start_t = seg.get("start", 0.0)
                end_t = seg.get("end", 0.0)
                segments_raw.append({"start": start_t, "end": end_t, "text": txt})
                ts_str = f"[{format_seconds(start_t)}] " if timestamps else ""
                formatted_segment_text = f"{ts_str}{txt}"
                full_text_blocks.append(formatted_segment_text)

                pct = int(min(98, max(4, (end_t / total_duration) * 100)))
                current_time_str = format_seconds(end_t)
                current_full_text = "\n\n".join(full_text_blocks)
                word_count = len(current_full_text.split())

                yield {
                    "type": "segment",
                    "progress": pct,
                    "current_time": current_time_str,
                    "total_time": total_time_str,
                    "segment_text": formatted_segment_text,
                    "full_text": current_full_text,
                    "word_count": word_count,
                    "start": start_t,
                    "end": end_t
                }

        if not segments_raw:
            yield {
                "type": "done",
                "progress": 100,
                "message": "No se detectó voz audible en el archivo.",
                "full_text": "",
                "segments": [],
                "word_count": 0
            }
            return

        # Diarización de hablantes si se solicitó
        final_full_text = "\n\n".join(full_text_blocks)
        if diarize and has_diarization_deps and len(segments_raw) > 0:
            yield {
                "type": "status",
                "progress": 99,
                "message": "Aplicando diferenciación acústica de hablantes...",
                "current_time": format_seconds(segments_raw[-1]["end"]),
                "total_time": total_time_str
            }
            segments_raw = OfflineAudioDiarizer.process_diarization(temp_wav_path, segments_raw, num_speakers=2)

            formatted_diarized_blocks = []
            current_speaker = None
            current_texts = []
            current_start_time = 0.0

            for seg in segments_raw:
                spk = seg.get("speaker", "Hablante 1")
                t_start = seg.get("start", 0.0)
                if spk != current_speaker:
                    if current_speaker is not None and current_texts:
                        ts_str = f"[{format_seconds(current_start_time)}] " if timestamps else ""
                        formatted_diarized_blocks.append(f"{ts_str}{current_speaker}: {' '.join(current_texts)}")
                        current_texts = []
                    current_speaker = spk
                    current_start_time = t_start
                current_texts.append(seg["text"])

            if current_speaker is not None and current_texts:
                ts_str = f"[{format_seconds(current_start_time)}] " if timestamps else ""
                formatted_diarized_blocks.append(f"{ts_str}{current_speaker}: {' '.join(current_texts)}")

            final_full_text = "\n\n".join(formatted_diarized_blocks)

        yield {
            "type": "done",
            "progress": 100,
            "message": "¡Transcripción completada con éxito!",
            "full_text": final_full_text,
            "segments": segments_raw,
            "word_count": len(final_full_text.split())
        }

    finally:
        for p in (temp_input_path, temp_wav_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass



def apply_pronunciation_rules(text: str, rules: list[list[str]]) -> str:
    """Aplica las reglas fonéticas del diccionario al texto."""
    if not text or not rules:
        return text or ""
    
    # Reemplazar guiones por espacios para lectura natural
    text = re.sub(r"[-—–_]", " ", text)
    
    # Ordenar por longitud descendente
    clean_rules = []
    for item in rules:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            w, s = str(item[0]).strip(), str(item[1]).strip()
            if w and s and w != s:
                clean_rules.append((w, s))
    clean_rules.sort(key=lambda x: len(x[0]), reverse=True)

    for written, spoken in clean_rules:
        escaped = re.escape(written)
        # Límites de palabra seguros
        text = re.sub(rf"(?<!\w){escaped}(?!\w)", spoken, text, flags=re.IGNORECASE)
    
    return text


VALID_EDGE_TTS_VOICES = {
    "es-CR-JuanNeural", "es-CR-MariaNeural", "es-ES-AlvaroNeural", "es-ES-ElviraNeural",
    "es-MX-DaliaNeural", "es-MX-JorgeNeural", "es-AR-ElenaNeural", "es-AR-TomasNeural",
    "es-CO-GonzaloNeural", "es-CO-SalomeNeural", "es-CL-CatalinaNeural", "es-CL-LorenzoNeural",
    "es-BO-MarceloNeural", "es-BO-SofiaNeural", "es-CU-BelkysNeural", "es-CU-ManuelNeural",
    "es-DO-EmilioNeural", "es-DO-RamonaNeural", "es-EC-AndreaNeural", "es-EC-LuisNeural",
    "es-SV-LorenaNeural", "es-SV-RodrigoNeural", "es-GQ-JavierNeural", "es-GQ-TeresaNeural",
    "es-GT-AndresNeural", "es-GT-MartaNeural", "es-HN-CarlosNeural", "es-HN-KarlaNeural",
    "es-NI-FedericoNeural", "es-NI-YolandaNeural", "es-PA-MargaritaNeural", "es-PA-RobertoNeural",
    "es-PY-MarioNeural", "es-PY-TaniaNeural", "es-PE-AlexNeural", "es-PE-CamilaNeural",
    "es-PR-KarinaNeural", "es-PR-VictorNeural", "es-US-AlonsoNeural", "es-US-PalomaNeural",
    "es-UY-MateoNeural", "es-UY-ValentinaNeural", "es-VE-PaolaNeural", "es-VE-SebastianNeural"
}


def resolve_edge_tts_voice(voice: str) -> str:
    """Valida y resuelve el nombre exacto de la voz para edge-tts con fallback seguro."""
    if not voice:
        return "es-CR-JuanNeural"
    if voice in VALID_EDGE_TTS_VOICES:
        return voice
    lower = voice.lower()
    for valid_voice in VALID_EDGE_TTS_VOICES:
        if valid_voice.lower() in lower or lower in valid_voice.lower():
            return valid_voice
    return "es-CR-JuanNeural"


async def synthesize_edge_tts(text: str, voice: str, rate: float = 1.0, pitch: float = 1.0, volume: float = 1.0) -> bytes:
    """Sintetiza texto a audio MP3 utilizando edge-tts con parámetros de voz exactos."""
    if edge_tts is None:
        raise RuntimeError("edge_tts no está disponible en este entorno Python.")
    
    # Conversión de parámetros a formato edge-tts
    rate_percent = int(round((rate - 1.0) * 100))
    pitch_hz = int(round((pitch - 1.0) * 50))
    volume_percent = int(round((volume - 1.0) * 100))
    
    rate_str = f"{rate_percent:+d}%"
    pitch_str = f"{pitch_hz:+d}Hz"
    volume_str = f"{volume_percent:+d}%"
    
    # Limpiar guiones en el texto
    clean_text = re.sub(r"[-—–_]", " ", text).strip()
    if not clean_text:
        return b""
    
    resolved_voice = resolve_edge_tts_voice(voice)
    communicate = edge_tts.Communicate(
        text=clean_text,
        voice=resolved_voice,
        rate=rate_str,
        volume=volume_str,
        pitch=pitch_str
    )
    
    out = io.BytesIO()
    async for message in communicate.stream():
        if message["type"] == "audio":
            out.write(message["data"])
            
    return out.getvalue()


class NeuralTTSHandler(SimpleHTTPRequestHandler):
    """Handler HTTP que sirve archivos estáticos y API de síntesis neural."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Language, X-Diarize, X-Timestamps, X-Filename")

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._set_cors_headers()
            self.end_headers()
            payload = {
                "status": "ok",
                "engine": "edge-tts" if edge_tts else "browser-speech",
                "has_edge_tts": edge_tts is not None,
                "has_transcription": has_faster_whisper or has_whisper,
                "transcription_engine": "faster-whisper" if has_faster_whisper else ("openai-whisper" if has_whisper else "none"),
                "message": "Servidor Neural de Ambystoma Technologies activo"
            }
            self.wfile.write(json.dumps(payload).encode("utf-8"))
            return

        # Servir archivos estáticos normalmente
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/transcribe":
            # Transcripción de archivo de audio con IA (faster-whisper o whisper)
            query_params = parse_qs(parsed.query)
            language = self.headers.get("X-Language") or query_params.get("lang", ["es"])[0]
            diarize_val = self.headers.get("X-Diarize") or query_params.get("diarize", ["1"])[0]
            timestamps_val = self.headers.get("X-Timestamps") or query_params.get("timestamps", ["1"])[0]
            filename = self.headers.get("X-Filename") or query_params.get("filename", ["audio.mp3"])[0]

            diarize = str(diarize_val).lower() in ("1", "true", "yes")
            timestamps = str(timestamps_val).lower() in ("1", "true", "yes")

            content_len = int(self.headers.get("Content-Length", 0))
            if content_len <= 0:
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": "No se recibió archivo de audio."}).encode("utf-8"))
                return

            audio_bytes = self.rfile.read(content_len)

            # Responder con SSE (Server-Sent Events) para actualizar la barra y el texto en tiempo real
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._set_cors_headers()
            self.end_headers()

            try:
                for event in stream_transcribe_audio_bytes(
                    audio_bytes=audio_bytes,
                    filename=filename,
                    language=language,
                    diarize=diarize,
                    timestamps=timestamps,
                    model_size="base"
                ):
                    payload = f"data: {json.dumps(event)}\n\n".encode("utf-8")
                    self.wfile.write(payload)
                    self.wfile.flush()
            except Exception as e:
                print(f"[ERROR] /api/transcribe streaming falló: {e}", file=sys.stderr)
                err_payload = f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n".encode("utf-8")
                try:
                    self.wfile.write(err_payload)
                    self.wfile.flush()
                except Exception:
                    pass
            return

        if parsed.path == "/api/tts":
            # Síntesis de una frase para reproducción en tiempo real
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                data = {}

            text = data.get("text", "")
            voice = data.get("voice", "es-CR-JuanNeural")
            rate = float(data.get("rate", 1.0))
            pitch = float(data.get("pitch", 1.0))
            volume = float(data.get("volume", 1.0))

            try:
                audio_bytes = asyncio.run(synthesize_edge_tts(text, voice, rate, pitch, volume))
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(audio_bytes)))
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(audio_bytes)
            except Exception as e:
                print(f"[ERROR] /api/tts falló: {e}", file=sys.stderr)
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        if parsed.path == "/api/download":
            # Descarga completa del audio sintetizado con reglas fonéticas
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                data = {}

            raw_text = data.get("text", "")
            rules = data.get("rules", [])
            voice = data.get("voice", "es-CR-JuanNeural")
            rate = float(data.get("rate", 1.0))
            pitch = float(data.get("pitch", 1.0))
            volume = float(data.get("volume", 1.0))

            # Aplicar reglas fonéticas antes de sintetizar
            processed_text = apply_pronunciation_rules(raw_text, rules)

            try:
                audio_bytes = asyncio.run(synthesize_edge_tts(processed_text, voice, rate, pitch, volume))
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "audio/mpeg")
                download_filename = data.get("filename") or "audio_lector_ambystoma.mp3"
                if not download_filename.lower().endswith(".mp3"):
                    download_filename += ".mp3"
                self.send_header("Content-Disposition", f'attachment; filename="{download_filename}"')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(audio_bytes)
            except Exception as e:
                print(f"[ERROR] /api/download falló: {e}", file=sys.stderr)
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()


def run_server():
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("=" * 65)
    print("  [OK] LectorVoz Pro - Servidor Neural de Ambystoma Technologies")
    print("=" * 65)
    print(f"  Directorio: {DIRECTORY}")
    print(f"  Motor Neural: {'edge-tts (Voces Naturales de Alta Calidad)' if edge_tts else 'No disponible'}")
    print(f"  URL Local: http://localhost:{PORT}")
    print("=" * 65)
    
    server = ThreadingHTTPServer(("0.0.0.0", PORT), NeuralTTSHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido por el usuario.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()

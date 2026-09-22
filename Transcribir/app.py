import sys
import os
import tempfile
import subprocess
import time
import math
import numpy as np
from scipy.io import wavfile
from scipy.fft import dct
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.preprocessing import StandardScaler

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QSize
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QComboBox, QCheckBox, QSpinBox, QTextEdit,
    QProgressBar, QFileDialog, QFrame, QMessageBox, QGroupBox, QSplitter
)
from PyQt6.QtGui import QFont, QIcon, QColor, QPalette, QDragEnterEvent, QDropEvent


# ==========================================
# HOJA DE ESTILOS QSS - MODO OSCURO PREMIUM
# ==========================================
DARK_STYLESHEET = """
QMainWindow {
    background-color: #0f172a;
}
QWidget {
    background-color: #0f172a;
    color: #f8fafc;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
}
QFrame#cardFrame {
    background-color: #1e293b;
    border-radius: 12px;
    border: 1px solid #334155;
}
QLabel {
    color: #cbd5e1;
}
QLabel#titleLabel {
    font-size: 22px;
    font-weight: bold;
    color: #38bdf8;
}
QLabel#subtitleLabel {
    font-size: 12px;
    color: #94a3b8;
}
QLabel#sectionTitle {
    font-size: 14px;
    font-weight: bold;
    color: #f1f5f9;
}
QPushButton {
    background-color: #3b82f6;
    color: #ffffff;
    font-weight: bold;
    border-radius: 8px;
    padding: 10px 18px;
    border: none;
}
QPushButton:hover {
    background-color: #2563eb;
}
QPushButton:pressed {
    background-color: #1d4ed8;
}
QPushButton:disabled {
    background-color: #475569;
    color: #94a3b8;
}
QPushButton#secondaryBtn {
    background-color: #334155;
    color: #e2e8f0;
    border: 1px solid #475569;
}
QPushButton#secondaryBtn:hover {
    background-color: #475569;
    color: #ffffff;
}
QPushButton#exportBtn {
    background-color: #10b981;
    color: #ffffff;
}
QPushButton#exportBtn:hover {
    background-color: #059669;
}
QComboBox, QSpinBox {
    background-color: #0f172a;
    color: #f8fafc;
    border: 1px solid #475569;
    border-radius: 6px;
    padding: 6px 12px;
}
QComboBox:hover, QSpinBox:hover {
    border-color: #38bdf8;
}
QComboBox::drop-down {
    border: none;
}
QCheckBox {
    color: #e2e8f0;
    spacing: 8px;
}
QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #475569;
    background-color: #0f172a;
}
QCheckBox::indicator:checked {
    background-color: #3b82f6;
    border-color: #3b82f6;
}
QTextEdit {
    background-color: #020617;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 12px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
}
QProgressBar {
    background-color: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    text-align: center;
    color: #ffffff;
    font-weight: bold;
}
QProgressBar::chunk {
    background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #3b82f6, stop:1 #06b6d4);
    border-radius: 5px;
}
QFrame#dropZone {
    background-color: #1e293b;
    border: 2px dashed #475569;
    border-radius: 12px;
}
QFrame#dropZone:hover {
    border-color: #38bdf8;
    background-color: #0f172a;
}
"""


# ==========================================
# DIARIZADOR ACÚSTICO OFFLINE (SPEAKER DIARIZATION)
# ==========================================
class OfflineAudioDiarizer:
    """
    Extrae características acústicas de cada segmento de audio
    y aplica clustering (KMeans/Agglomerative) para diferenciar hablantes.
    """

    @staticmethod
    def extract_mfcc(signal, sr=16000, num_cep=13, nfft=512):
        if len(signal) < nfft:
            signal = np.pad(signal, (0, nfft - len(signal)))
        
        # Enmarcado y ventana Hamming
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
        
        # Ventana Hamming + Magnitud FFT
        frames *= np.hamming(frame_len)
        mag_frames = np.abs(np.fft.rfft(frames, nfft))
        pow_frames = (1.0 / nfft) * (mag_frames ** 2)
        
        # Banco de filtros Mel
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
        
        # DCT para obtener MFCCs
        mfcc_feat = dct(filter_banks, type=2, axis=1, norm='ortho')[:, :num_cep]
        return np.mean(mfcc_feat, axis=0)

    @classmethod
    def process_diarization(cls, audio_wav_path, segments, num_speakers=2):
        """
        Asigna un hablante (Hablante 1, Hablante 2, etc.) a cada segmento transcrito.
        """
        if not segments:
            return []

        try:
            sr, audio_data = wavfile.read(audio_wav_path)
            # Convertir a float mono si es necesario
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
                if len(segment_audio) < int(0.1 * sr): # al menos 100ms
                    continue

                feat = cls.extract_mfcc(segment_audio, sr=sr)
                features.append(feat)
                valid_indices.append(idx)

            if len(features) < num_speakers:
                # Si hay pocos segmentos, asignar por defecto Hablante 1
                for seg in segments:
                    seg['speaker'] = "Hablante 1"
                return segments

            # Normalizar vector de características y clustering
            X = np.array(features)
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            if len(features) >= 4:
                clustering = AgglomerativeClustering(n_clusters=num_speakers)
            else:
                clustering = KMeans(n_clusters=num_speakers, random_state=42, n_init=10)
            
            labels = clustering.fit_predict(X_scaled)

            # Mapear etiquetas a Hablante 1, Hablante 2, etc.
            speaker_map = {lbl: f"Hablante {lbl + 1}" for lbl in set(labels)}

            for idx, label_idx in zip(valid_indices, labels):
                segments[idx]['speaker'] = speaker_map[label_idx]

            # Rellenar segmentos no asignados si hubiera
            current_spk = "Hablante 1"
            for seg in segments:
                if 'speaker' not in seg:
                    seg['speaker'] = current_spk
                else:
                    current_spk = seg['speaker']

        except Exception as e:
            print(f"Error en diarización: {e}")
            for seg in segments:
                seg['speaker'] = "Hablante 1"

        return segments


# ==========================================
# WORKER HILO SECUNDARIO (TRANSCRIPCIÓN)
# ==========================================
class TranscriptionWorker(QThread):
    progress_signal = pyqtSignal(int, str)
    finished_signal = pyqtSignal(list, str) # (segmentos_con_formato, texto_completo)
    error_signal = pyqtSignal(str)

    def __init__(self, audio_path, model_size="base", language="es", diarize=True, num_speakers=2):
        super().__init__()
        self.audio_path = audio_path
        self.model_size = model_size
        self.language = language
        self.diarize = diarize
        self.num_speakers = num_speakers
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True

    def run(self):
        temp_wav = None
        try:
            self.progress_signal.emit(10, "Preparando archivo de audio...")
            
            # 1. Convertir audio a WAV Mono 16kHz con FFmpeg
            temp_dir = tempfile.gettempdir()
            temp_wav = os.path.join(temp_dir, f"transcribe_temp_{int(time.time())}.wav")
            
            cmd = [
                "ffmpeg", "-y", "-i", self.audio_path,
                "-ac", "1", "-ar", "16000", "-vn",
                temp_wav
            ]
            
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            
            if self._is_cancelled:
                return

            # 2. Cargar modelo e Iniciar Transcripción
            self.progress_signal.emit(30, f"Cargando modelo Whisper ({self.model_size})...")
            
            segments_raw = []
            lang_param = None if self.language == "auto" else self.language

            # Probar utilizar faster-whisper primero, luego openai-whisper como fallback
            try:
                from faster_whisper import WhisperModel
                self.progress_signal.emit(45, "Transcribiendo con engine 'faster-whisper'...")
                model = WhisperModel(self.model_size, device="cpu", compute_type="int8")
                segments_iter, info = model.transcribe(
                    temp_wav,
                    language=lang_param,
                    beam_size=5,
                    word_timestamps=False
                )
                
                total_duration = info.duration if info and info.duration > 0 else 1.0
                
                for seg in segments_iter:
                    if self._is_cancelled:
                        return
                    segments_raw.append({
                        'start': seg.start,
                        'end': seg.end,
                        'text': seg.text.strip()
                    })
                    pct = int(45 + (seg.end / total_duration) * 35)
                    pct = min(pct, 80)
                    self.progress_signal.emit(pct, f"Transcribiendo... [{int(seg.end)}s / {int(total_duration)}s]")

            except Exception as fw_err:
                print(f"Faster-whisper no disponible o falló ({fw_err}). Usando openai-whisper...")
                import whisper
                self.progress_signal.emit(45, "Transcribiendo con engine 'openai-whisper'...")
                model = whisper.load_model(self.model_size)
                result = model.transcribe(temp_wav, language=lang_param)
                for seg in result.get('segments', []):
                    segments_raw.append({
                        'start': seg['start'],
                        'end': seg['end'],
                        'text': seg['text'].strip()
                    })

            if self._is_cancelled:
                return

            if not segments_raw:
                self.error_signal.emit("No se detectó ningún texto o audio legible en el archivo.")
                return

            # 3. Diferenciación de Hablantes (Diarización)
            if self.diarize:
                self.progress_signal.emit(85, "Diferenciando hablantes (Hablante 1 vs Hablante 2)...")
                segments_raw = OfflineAudioDiarizer.process_diarization(
                    temp_wav, segments_raw, num_speakers=self.num_speakers
                )
            else:
                for seg in segments_raw:
                    seg['speaker'] = None

            # 4. Formatear Resultados
            self.progress_signal.emit(95, "Generando formato de transcripción...")
            formatted_lines = []
            current_speaker = None
            current_text_block = []
            
            for seg in segments_raw:
                speaker = seg.get('speaker')
                timestamp_str = self.format_timestamp(seg['start'])
                
                if speaker:
                    if speaker != current_speaker:
                        if current_speaker is not None:
                            formatted_lines.append(f"[{timestamp_str}] {current_speaker}: {' '.join(current_text_block)}")
                            current_text_block = []
                        current_speaker = speaker
                    current_text_block.append(seg['text'])
                else:
                    formatted_lines.append(f"[{timestamp_str}] {seg['text']}")

            if current_speaker and current_text_block:
                timestamp_str = self.format_timestamp(segments_raw[-1]['start'])
                formatted_lines.append(f"[{timestamp_str}] {current_speaker}: {' '.join(current_text_block)}")

            full_text = "\n\n".join(formatted_lines)
            
            self.progress_signal.emit(100, "¡Transcripción completada!")
            self.finished_signal.emit(segments_raw, full_text)

        except Exception as e:
            self.error_signal.emit(f"Error procesando la transcripción: {str(e)}")
        finally:
            if temp_wav and os.path.exists(temp_wav):
                try:
                    os.remove(temp_wav)
                except Exception:
                    pass

    @staticmethod
    def format_timestamp(seconds):
        hrs = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        if hrs > 0:
            return f"{hrs:02d}:{mins:02d}:{secs:02d}"
        return f"{mins:02d}:{secs:02d}"


# ==========================================
# ÁREA DE DRAG AND DROP PERSONALIZADA
# ==========================================
class DropArea(QFrame):
    file_dropped = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("dropZone")
        self.setAcceptDrops(True)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 30, 20, 30)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        self.icon_label = QLabel("🎵", self)
        self.icon_label.setStyleSheet("font-size: 38px; background: transparent;")
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        self.text_label = QLabel("Arrastra tu archivo de audio aquí\no haz clic en 'Buscar Archivo'", self)
        self.text_label.setStyleSheet("font-size: 14px; font-weight: bold; color: #94a3b8; background: transparent;")
        self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        self.file_name_label = QLabel("", self)
        self.file_name_label.setStyleSheet("font-size: 13px; font-weight: bold; color: #38bdf8; background: transparent;")
        self.file_name_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        layout.addWidget(self.icon_label)
        layout.addWidget(self.text_label)
        layout.addWidget(self.file_name_label)

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent):
        urls = event.mimeData().urls()
        if urls:
            file_path = urls[0].toLocalFile()
            if self.is_valid_audio(file_path):
                self.file_dropped.emit(file_path)
            else:
                QMessageBox.warning(self, "Formato no soportado", "Por favor selecciona un archivo de audio válido (.mp3, .wav, .m4a, .flac, .ogg, .aac, .wma).")

    @staticmethod
    def is_valid_audio(path):
        exts = ('.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.opus', '.mp4', '.mkv')
        return path.lower().endswith(exts)

    def set_file_info(self, file_path):
        filename = os.path.basename(file_path)
        size_mb = os.path.getsize(file_path) / (1024 * 1024)
        self.text_label.setText("Archivo seleccionado:")
        self.file_name_label.setText(f"{filename} ({size_mb:.1f} MB)")
        self.icon_label.setText("🎙️")


# ==========================================
# VENTANA PRINCIPAL (MAIN WINDOW)
# ==========================================
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Transcriptor de Audio AI - Modo Oscuro")
        self.resize(1000, 750)
        self.setMinimumSize(850, 600)
        
        self.selected_audio_path = None
        self.worker = None

        self.setup_ui()

    def setup_ui(self):
        main_widget = QWidget(self)
        self.setCentralWidget(main_widget)
        
        main_layout = QVBoxLayout(main_widget)
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(16)

        # 1. ENCABEZADO
        header_layout = QHBoxLayout()
        title_box = QVBoxLayout()
        
        title = QLabel("Transcriptor de Audio AI", self)
        title.setObjectName("titleLabel")
        subtitle = QLabel("Transcribe audios en español con diferenciación automática de hablantes (Hablante 1 / Hablante 2)", self)
        subtitle.setObjectName("subtitleLabel")
        
        title_box.addWidget(title)
        title_box.addWidget(subtitle)
        header_layout.addLayout(title_box)
        header_layout.addStretch()
        
        main_layout.addLayout(header_layout)

        # 2. SPLITTER PRINCIPAL (PANEL IZQUIERDO Y DERECHO)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        
        # --- PANEL IZQUIERDO: CONTROLES ---
        left_panel = QFrame()
        left_panel.setObjectName("cardFrame")
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(18, 18, 18, 18)
        left_layout.setSpacing(14)

        # Zona de Arrastrar y Soltar
        self.drop_zone = DropArea(self)
        self.drop_zone.file_dropped.connect(self.on_file_selected)
        left_layout.addWidget(self.drop_zone)

        # Botón Buscar Archivo
        self.btn_select_file = QPushButton("📂 Seleccionar Archivo de Audio", self)
        self.btn_select_file.setObjectName("secondaryBtn")
        self.btn_select_file.clicked.connect(self.open_file_dialog)
        left_layout.addWidget(self.btn_select_file)

        # Grupo de Configuración
        config_group = QGroupBox("Opciones de Transcripción", self)
        config_group.setStyleSheet("QGroupBox { font-weight: bold; border: 1px solid #334155; border-radius: 8px; margin-top: 10px; padding-top: 12px; } QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 5px; color: #38bdf8; }")
        config_layout = QVBoxLayout(config_group)
        config_layout.setSpacing(12)

        # Modelo Whisper
        model_layout = QHBoxLayout()
        model_label = QLabel("Modelo Whisper:", self)
        self.combo_model = QComboBox(self)
        self.combo_model.addItems(["base (Recomendado CPU)", "tiny (Ultra rápido)", "small (Alta precisión)", "medium (Máxima calidad)"])
        self.combo_model.setCurrentIndex(0)
        model_layout.addWidget(model_label)
        model_layout.addWidget(self.combo_model)
        config_layout.addLayout(model_layout)

        # Idioma
        lang_layout = QHBoxLayout()
        lang_label = QLabel("Idioma:", self)
        self.combo_lang = QComboBox(self)
        self.combo_lang.addItems(["Español (es)", "Detectar automáticamente (auto)"])
        lang_layout.addWidget(lang_label)
        lang_layout.addWidget(self.combo_lang)
        config_layout.addLayout(lang_layout)

        # Checkbox Diarización (Diferenciar Hablantes)
        self.chk_diarize = QCheckBox("Diferenciar hablantes (Hablante 1 / Hablante 2)", self)
        self.chk_diarize.setChecked(True)
        self.chk_diarize.toggled.connect(self.toggle_diarize_options)
        config_layout.addWidget(self.chk_diarize)

        # Cantidad de hablantes
        spk_layout = QHBoxLayout()
        self.spk_label = QLabel("Número de hablantes:", self)
        self.spin_speakers = QSpinBox(self)
        self.spin_speakers.setRange(2, 10)
        self.spin_speakers.setValue(2)
        spk_layout.addWidget(self.spk_label)
        spk_layout.addWidget(self.spin_speakers)
        config_layout.addLayout(spk_layout)

        left_layout.addWidget(config_group)
        left_layout.addStretch()

        # Botón Iniciar Transcripción
        self.btn_start = QPushButton("🚀 Iniciar Transcripción", self)
        self.btn_start.setFixedHeight(45)
        self.btn_start.clicked.connect(self.start_transcription)
        left_layout.addWidget(self.btn_start)

        splitter.addWidget(left_panel)

        # --- PANEL DERECHO: RESULTADOS Y TEXTO ---
        right_panel = QFrame()
        right_panel.setObjectName("cardFrame")
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(18, 18, 18, 18)
        right_layout.setSpacing(12)

        # Título del panel derecho y barra de estado
        top_result_layout = QHBoxLayout()
        result_title = QLabel("Resultado de Transcripción", self)
        result_title.setObjectName("sectionTitle")
        
        top_result_layout.addWidget(result_title)
        top_result_layout.addStretch()
        right_layout.addLayout(top_result_layout)

        # Barra de progreso e información
        self.status_label = QLabel("Estado: Esperando archivo...", self)
        self.status_label.setStyleSheet("color: #94a3b8;")
        right_layout.addWidget(self.status_label)

        self.progress_bar = QProgressBar(self)
        self.progress_bar.setValue(0)
        self.progress_bar.setFixedHeight(14)
        self.progress_bar.setTextVisible(False)
        right_layout.addWidget(self.progress_bar)

        # Área de Texto del Resultado
        self.text_editor = QTextEdit(self)
        self.text_editor.setPlaceholderText("La transcripción aparecerá aquí formateada por marcas de tiempo y hablantes...")
        right_layout.addWidget(self.text_editor)

        # Botones de Acción de Texto
        action_btn_layout = QHBoxLayout()
        
        self.btn_copy = QPushButton("📋 Copiar Texto", self)
        self.btn_copy.setObjectName("secondaryBtn")
        self.btn_copy.clicked.connect(self.copy_to_clipboard)
        
        self.btn_clear = QPushButton("🗑️ Limpiar", self)
        self.btn_clear.setObjectName("secondaryBtn")
        self.btn_clear.clicked.connect(self.clear_text)
        
        self.btn_export = QPushButton("💾 Guardar en .TXT", self)
        self.btn_export.setObjectName("exportBtn")
        self.btn_export.clicked.connect(self.export_to_txt)
        
        action_btn_layout.addWidget(self.btn_copy)
        action_btn_layout.addWidget(self.btn_clear)
        action_btn_layout.addStretch()
        action_btn_layout.addWidget(self.btn_export)
        
        right_layout.addLayout(action_btn_layout)

        splitter.addWidget(right_panel)

        # Proporción del Splitter (35% izquierda, 65% derecha)
        splitter.setSizes([350, 650])
        main_layout.addWidget(splitter)

    def toggle_diarize_options(self, checked):
        self.spk_label.setEnabled(checked)
        self.spin_speakers.setEnabled(checked)

    def open_file_dialog(self):
        file_filter = "Archivos de Audio (*.mp3 *.wav *.m4a *.flac *.ogg *.aac *.wma *.opus *.mp4 *.mkv);;Todos los Archivos (*.*)"
        path, _ = QFileDialog.getOpenFileName(self, "Seleccionar Archivo de Audio", "", file_filter)
        if path:
            self.on_file_selected(path)

    def on_file_selected(self, file_path):
        self.selected_audio_path = file_path
        self.drop_zone.set_file_info(file_path)
        self.status_label.setText("Listo para transcribir.")
        self.progress_bar.setValue(0)

    def start_transcription(self):
        if not self.selected_audio_path:
            QMessageBox.warning(self, "Atención", "Por favor selecciona un archivo de audio antes de iniciar.")
            return

        if not os.path.exists(self.selected_audio_path):
            QMessageBox.critical(self, "Error", "El archivo seleccionado ya no existe.")
            return

        # Deshabilitar controles durante la transcripción
        self.set_controls_enabled(False)
        self.progress_bar.setValue(0)
        self.status_label.setText("Iniciando motor de transcripción...")

        model_key = self.combo_model.currentText().split()[0]
        lang_key = "es" if "Español" in self.combo_lang.currentText() else "auto"
        diarize = self.chk_diarize.isChecked()
        num_speakers = self.spin_speakers.value()

        # Iniciar Hilo Worker
        self.worker = TranscriptionWorker(
            audio_path=self.selected_audio_path,
            model_size=model_key,
            language=lang_key,
            diarize=diarize,
            num_speakers=num_speakers
        )
        
        self.worker.progress_signal.connect(self.on_progress)
        self.worker.finished_signal.connect(self.on_transcription_finished)
        self.worker.error_signal.connect(self.on_transcription_error)
        self.worker.start()

    def on_progress(self, percentage, status_message):
        self.progress_bar.setValue(percentage)
        self.status_label.setText(f"Estado: {status_message}")

    def on_transcription_finished(self, raw_segments, full_text):
        self.text_editor.setText(full_text)
        self.set_controls_enabled(True)
        self.status_label.setText("¡Transcripción finalizada con éxito!")
        QMessageBox.information(self, "Éxito", "La transcripción se ha completado correctamente.")

    def on_transcription_error(self, error_msg):
        self.set_controls_enabled(True)
        self.status_label.setText("Error en la transcripción.")
        QMessageBox.critical(self, "Error de Transcripción", error_msg)

    def set_controls_enabled(self, enabled):
        self.btn_start.setEnabled(enabled)
        self.btn_select_file.setEnabled(enabled)
        self.combo_model.setEnabled(enabled)
        self.combo_lang.setEnabled(enabled)
        self.chk_diarize.setEnabled(enabled)
        self.spin_speakers.setEnabled(enabled and self.chk_diarize.isChecked())

    def copy_to_clipboard(self):
        text = self.text_editor.toPlainText()
        if text.strip():
            clipboard = QApplication.clipboard()
            clipboard.setText(text)
            self.status_label.setText("Copiado al portapapeles.")
        else:
            QMessageBox.information(self, "Información", "No hay texto para copiar.")

    def clear_text(self):
        self.text_editor.clear()
        self.status_label.setText("Texto limpiado.")

    def export_to_txt(self):
        text = self.text_editor.toPlainText()
        if not text.strip():
            QMessageBox.warning(self, "Atención", "No hay contenido transcrito para exportar.")
            return

        default_name = "transcripcion.txt"
        if self.selected_audio_path:
            base_name = os.path.splitext(os.path.basename(self.selected_audio_path))[0]
            default_name = f"transcripcion_{base_name}.txt"

        file_path, _ = QFileDialog.getSaveFileName(
            self, "Guardar Transcripción como TXT", default_name, "Archivos de Texto (*.txt)"
        )

        if file_path:
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(text)
                self.status_label.setText(f"Guardado en: {os.path.basename(file_path)}")
                QMessageBox.information(self, "Guardado", f"El archivo ha sido guardado exitosamente en:\n{file_path}")
            except Exception as e:
                QMessageBox.critical(self, "Error al guardar", f"No se pudo guardar el archivo:\n{str(e)}")


# ==========================================
# PUNTO DE ENTRADA PRINCIPAL
# ==========================================
def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setStyleSheet(DARK_STYLESHEET)
    
    window = MainWindow()
    window.show()
    
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

"""
Lector de ebooks/textos a voz en español con PyQt6 + edge-tts.

Incluye corrección de pronunciación personalizada para nombres raros,
por ejemplo: Rhyz -> Rís, para evitar que el motor lo deletree.

Formatos soportados:
- TXT, MD, CSV, SRT, VTT
- HTML / HTM
- EPUB        requiere: ebooklib beautifulsoup4
- PDF         requiere: pypdf
- DOCX        requiere: python-docx

Instalación recomendada:
    python -m pip install PyQt6 PyQt6-Qt6 PyQt6-sip edge-tts beautifulsoup4 ebooklib pypdf python-docx

Ejecutar:
    python app.py

Nota:
- edge-tts usa voces neuronales online. Necesita conexión a Internet.
- El audio se guarda como MP3.
"""

from __future__ import annotations

import asyncio
import html
import os
import re
import sys
import traceback
import tempfile
import unicodedata
import uuid
from pathlib import Path
from typing import Callable, Dict, List, Optional

from PyQt6.QtCore import QObject, QThread, QUrl, Qt, pyqtSignal
from PyQt6.QtMultimedia import QAudioOutput, QMediaPlayer
from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QProgressBar,
    QScrollArea,
    QSlider,
    QSpinBox,
    QSplitter,
    QHeaderView,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

try:
    import edge_tts
except ImportError:  # Se maneja con mensaje claro en la interfaz
    edge_tts = None


# ----------------------------- Lectura de archivos -----------------------------

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".srt", ".vtt", ".log", ".json", ".xml"}
HTML_EXTENSIONS = {".html", ".htm"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | HTML_EXTENSIONS | {".epub", ".pdf", ".docx", ".rtf"}


def normalize_text(text: str) -> str:
    """Limpia espacios excesivos sin destruir los párrafos.

    También elimina caracteres Unicode invisibles que los EPUB insertan
    para tipografía (guiones suaves, espacios de ancho cero, BOM, etc.),
    y los separadores de párrafo/línea que Qt inyecta internamente
    (U+2028, U+2029) al usar QTextEdit.setPlainText().
    Sin esta limpieza, palabras como "Rhy\u00adz" no coinciden con la
    regla de pronunciación que busca "Rhyz".
    """
    text = html.unescape(text or "")
    # Eliminar caracteres invisibles / de formato comunes en EPUB y Qt
    text = re.sub(r"[\u00ad\u200b\u200c\u200d\ufeff\u2060\u2028\u2029]", "", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\t\x0b\x0c]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()


def read_text_file(path: Path) -> str:
    """Lee texto simple probando varias codificaciones comunes."""
    encodings = ["utf-8-sig", "utf-8", "cp1252", "latin-1"]
    last_error: Optional[Exception] = None
    for enc in encodings:
        try:
            return path.read_text(encoding=enc, errors="strict")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    # Último intento tolerante
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"No pude leer el archivo como texto. Error: {last_error or exc}")


def read_html(path: Path) -> str:
    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:
        raise RuntimeError("Para leer HTML instala: python -m pip install beautifulsoup4") from exc
    raw = read_text_file(path)
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text("\n")


def read_epub(path: Path) -> str:
    try:
        import ebooklib
        from ebooklib import epub
        from bs4 import BeautifulSoup
    except ImportError as exc:
        raise RuntimeError("Para leer EPUB instala: python -m pip install ebooklib beautifulsoup4") from exc

    book = epub.read_epub(str(path))
    parts: List[str] = []
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            text = soup.get_text("\n")
            if text.strip():
                parts.append(text)
    return "\n\n".join(parts)


def read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("Para leer PDF instala: python -m pip install pypdf") from exc

    reader = PdfReader(str(path))
    pages: List[str] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001
            text = ""
        if text.strip():
            pages.append(f"\n\n--- Página {i} ---\n{text}")
    if not pages:
        raise RuntimeError("No pude extraer texto del PDF. Si es escaneado, necesita OCR.")
    return "".join(pages)


def read_docx(path: Path) -> str:
    try:
        import docx
    except ImportError as exc:
        raise RuntimeError("Para leer DOCX instala: python -m pip install python-docx") from exc

    document = docx.Document(str(path))
    paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                paragraphs.append(row_text)
    return "\n\n".join(paragraphs)


def read_rtf(path: Path) -> str:
    """Extracción básica de RTF. Para documentos complejos, conviene convertir a TXT/DOCX."""
    raw = read_text_file(path)
    raw = re.sub(r"\\'[0-9a-fA-F]{2}", " ", raw)
    raw = re.sub(r"\\[a-zA-Z]+-?\d* ?", " ", raw)
    raw = raw.replace("{", " ").replace("}", " ").replace("\\", " ")
    return raw


def extract_text_from_file(file_path: str) -> str:
    path = Path(file_path)
    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise RuntimeError(f"Formato no soportado: {ext}")

    if ext in TEXT_EXTENSIONS:
        text = read_text_file(path)
    elif ext in HTML_EXTENSIONS:
        text = read_html(path)
    elif ext == ".epub":
        text = read_epub(path)
    elif ext == ".pdf":
        text = read_pdf(path)
    elif ext == ".docx":
        text = read_docx(path)
    elif ext == ".rtf":
        text = read_rtf(path)
    else:
        raise RuntimeError(f"Formato no soportado: {ext}")

    text = normalize_text(text)
    if not text:
        raise RuntimeError("El archivo no contiene texto legible.")
    return text


# ----------------------------- Síntesis de voz -----------------------------


def split_text_for_tts(text: str, max_chars: int = 3500) -> List[str]:
    """Divide el texto en fragmentos seguros para TTS, respetando párrafos y frases."""
    text = normalize_text(text)
    if not text:
        return []

    chunks: List[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current.strip():
            chunks.append(current.strip())
            current = ""

    paragraphs = re.split(r"\n\s*\n", text)
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        if len(paragraph) > max_chars:
            # Divide por frases si el párrafo es enorme.
            sentences = re.split(r"(?<=[.!?¿¡;:])\s+", paragraph)
        else:
            sentences = [paragraph]

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            if len(sentence) > max_chars:
                # Corte duro para frases extremadamente largas.
                flush()
                for i in range(0, len(sentence), max_chars):
                    chunks.append(sentence[i : i + max_chars].strip())
                continue

            candidate = f"{current}\n\n{sentence}" if current else sentence
            if len(candidate) <= max_chars:
                current = candidate
            else:
                flush()
                current = sentence

    flush()
    return chunks


# ----------------------------- Pronunciación personalizada -----------------------------

_WORD_CHARS_ES = r"0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ_"


def apply_pronunciation_rules(text: str, rules: Optional[List[tuple[str, str]]] = None) -> str:
    """
    Reescribe palabras o nombres antes de enviarlos al motor TTS.

    Usa una estrategia de coincidencia en 3 capas para garantizar que el
    diccionario funcione con cualquier fuente de texto (tipeo manual, EPUB,
    PDF, DOCX, etc.):

      Capa 1 (primaria): regex con límites de palabra españoles personalizados.
      Capa 2 (fallback): \\b de Python, que respeta Unicode correctamente.
      Capa 3 (last resort): reemplazo simple sin límites de palabra.

    También aplica normalización Unicode NFC sobre el texto y sobre cada término
    de búsqueda, para que caracteres visualmente idénticos pero con distinto
    codepoint (muy comunes en texto extraído de EPUB) sean tratados igual.
    """
    if not text or not rules:
        return text or ""

    # 1. Limpiar y normalizar el texto de entrada.
    fixed_text = normalize_text(text)
    fixed_text = unicodedata.normalize("NFC", fixed_text)

    # 2. Construir lista de reglas válidas, ordenadas de mayor a menor longitud.
    clean_rules: List[tuple[str, str]] = []
    for written, spoken in rules:
        written = unicodedata.normalize("NFC", (written or "").strip())
        spoken = (spoken or "").strip()
        if written and spoken and written != spoken:
            clean_rules.append((written, spoken))
    clean_rules.sort(key=lambda item: len(item[0]), reverse=True)

    for written, spoken in clean_rules:
        escaped = re.escape(written)

        # --- Capa 1: límites españoles personalizados ---
        pattern_1 = rf"(?<![{_WORD_CHARS_ES}]){escaped}(?![{_WORD_CHARS_ES}])"
        new_text = re.sub(pattern_1, spoken, fixed_text, flags=re.IGNORECASE)

        if new_text != fixed_text:
            fixed_text = new_text
            continue  # regla aplicada, siguiente

        # --- Capa 2: \b Unicode de Python ---
        pattern_2 = rf"\b{escaped}\b"
        new_text = re.sub(pattern_2, spoken, fixed_text, flags=re.IGNORECASE | re.UNICODE)

        if new_text != fixed_text:
            fixed_text = new_text
            continue

        # --- Capa 3: reemplazo simple (sin límites de palabra) ---
        # Último recurso: al menos asegura que el nombre se pronuncie bien
        # aunque esté pegado a puntuación extraña.
        fixed_text = re.sub(escaped, spoken, fixed_text, flags=re.IGNORECASE)

    return fixed_text


async def synthesize_to_mp3(
    *,
    text: str,
    output_path: str,
    voice: str,
    rate_percent: int,
    volume_percent: int,
    pitch_hz: int,
    chunk_chars: int,
    pronunciation_rules: Optional[List[tuple[str, str]]] = None,
    progress_callback: Optional[Callable[[str, int], None]] = None,
) -> None:
    if edge_tts is None:
        raise RuntimeError("Falta edge-tts. Instala: python -m pip install edge-tts")

    # Dividimos primero para que cada fragmento ya esté limpio (normalize_text
    # se aplica dentro de split_text_for_tts), y luego aplicamos las reglas
    # de pronunciación sobre el texto limpio de cada fragmento.
    chunks = split_text_for_tts(text, max_chars=chunk_chars)
    if not chunks:
        raise RuntimeError("No hay texto suficiente para convertir a voz.")
    if pronunciation_rules:
        chunks = [apply_pronunciation_rules(chunk, pronunciation_rules) for chunk in chunks]

    rate = f"{rate_percent:+d}%"
    volume = f"{volume_percent:+d}%"
    pitch = f"{pitch_hz:+d}Hz"

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    # Escribimos todos los fragmentos en un único MP3.
    with output.open("wb") as audio_file:
        for index, chunk in enumerate(chunks, start=1):
            percent = int((index - 1) / len(chunks) * 100)
            if progress_callback:
                progress_callback(f"Convirtiendo fragmento {index}/{len(chunks)}...", percent)

            communicate = edge_tts.Communicate(
                text=chunk,
                voice=voice,
                rate=rate,
                volume=volume,
                pitch=pitch,
            )
            async for message in communicate.stream():
                if message["type"] == "audio":
                    audio_file.write(message["data"])

    if progress_callback:
        progress_callback("Conversión terminada.", 100)


# ----------------------------- Workers para no congelar la UI -----------------------------

class VoicesWorker(QObject):
    finished = pyqtSignal(list)
    error = pyqtSignal(str)

    def run(self) -> None:
        try:
            if edge_tts is None:
                raise RuntimeError("Falta edge-tts. Instala: python -m pip install edge-tts")
            voices = asyncio.run(edge_tts.list_voices())
            self.finished.emit(voices)
        except Exception as exc:  # noqa: BLE001
            self.error.emit(str(exc))


class TTSWorker(QObject):
    status = pyqtSignal(str)
    progress = pyqtSignal(int)
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(
        self,
        *,
        text: str,
        output_path: str,
        voice: str,
        rate_percent: int,
        volume_percent: int,
        pitch_hz: int,
        chunk_chars: int,
        pronunciation_rules: Optional[List[tuple[str, str]]] = None,
    ) -> None:
        super().__init__()
        self.text = text
        self.output_path = output_path
        self.voice = voice
        self.rate_percent = rate_percent
        self.volume_percent = volume_percent
        self.pitch_hz = pitch_hz
        self.chunk_chars = chunk_chars
        self.pronunciation_rules = pronunciation_rules or []

    def _progress_callback(self, message: str, percent: int) -> None:
        self.status.emit(message)
        self.progress.emit(percent)

    def run(self) -> None:
        try:
            asyncio.run(
                synthesize_to_mp3(
                    text=self.text,
                    output_path=self.output_path,
                    voice=self.voice,
                    rate_percent=self.rate_percent,
                    volume_percent=self.volume_percent,
                    pitch_hz=self.pitch_hz,
                    chunk_chars=self.chunk_chars,
                    pronunciation_rules=self.pronunciation_rules,
                    progress_callback=self._progress_callback,
                )
            )
            self.finished.emit(self.output_path)
        except Exception as exc:  # noqa: BLE001
            details = traceback.format_exc()
            self.error.emit(f"{exc}\n\nDetalles técnicos:\n{details}")


# ----------------------------- Ventana principal -----------------------------

class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Lector de ebook/texto a voz - Español neural - PLAY + pronunciación personalizada")
        self.resize(980, 760)

        self.current_file: Optional[str] = None
        self.current_output: Optional[str] = None
        self.all_voices: List[Dict[str, str]] = []
        self.auto_play_after_tts = False
        self.show_popup_after_tts = True

        self.player = QMediaPlayer(self)
        self.audio_output = QAudioOutput(self)
        self.player.setAudioOutput(self.audio_output)
        self.audio_output.setVolume(0.85)

        self._voices_thread: Optional[QThread] = None
        self._voices_worker: Optional[VoicesWorker] = None
        self._tts_thread: Optional[QThread] = None
        self._tts_worker: Optional[TTSWorker] = None

        self._build_ui()
        self._load_fallback_voices()
        self.load_voices_online()

    def _build_ui(self) -> None:
        # ── Widget raíz con margen ──────────────────────────────────────────
        root = QWidget()
        root_layout = QVBoxLayout(root)
        root_layout.setContentsMargins(10, 8, 10, 8)
        root_layout.setSpacing(6)

        # Título
        title = QLabel("🔊 Convertidor de textos y ebooks a voz en español")
        title.setStyleSheet(
            "font-size: 18px; font-weight: 700; "
            "padding: 6px 0; color: #1a1a2e;"
        )
        root_layout.addWidget(title)

        # ── Splitter principal: columna izquierda | columna derecha ─────────
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setHandleWidth(6)
        root_layout.addWidget(splitter, stretch=1)

        # ════════════════════════════════════════════════════════════════════
        # COLUMNA IZQUIERDA: archivo + texto + pronunciación
        # ════════════════════════════════════════════════════════════════════
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        left_layout.setContentsMargins(0, 0, 4, 0)
        left_layout.setSpacing(8)

        # — Sección 1: Cargar archivo ———————————————————————————————————————
        file_box = QGroupBox("1 · Cargar archivo")
        file_layout = QVBoxLayout(file_box)
        file_layout.setSpacing(4)

        row_file = QHBoxLayout()
        self.file_line = QLineEdit()
        self.file_line.setReadOnly(True)
        self.file_line.setPlaceholderText("TXT, EPUB, PDF, DOCX, HTML, MD, CSV, SRT, VTT, RTF…")
        btn_open = QPushButton("📂  Abrir archivo")
        btn_open.setFixedWidth(150)
        btn_open.clicked.connect(self.open_file)
        row_file.addWidget(self.file_line)
        row_file.addWidget(btn_open)
        file_layout.addLayout(row_file)

        self.file_info = QLabel("Formatos soportados: TXT · MD · EPUB · PDF · DOCX · HTML · CSV · SRT · VTT · RTF")
        self.file_info.setStyleSheet("color: #666; font-size: 11px;")
        file_layout.addWidget(self.file_info)
        left_layout.addWidget(file_box)

        # — Sección 2: Texto editable ——————————————————————————————————————
        text_box = QGroupBox("2 · Vista previa / texto editable")
        text_layout = QVBoxLayout(text_box)
        text_layout.setSpacing(6)

        self.text_edit = QTextEdit()
        self.text_edit.setPlaceholderText(
            "Escribe o pega aquí el texto que quieres escuchar…\n"
            "También puedes cargar un archivo con el botón de arriba."
        )
        text_layout.addWidget(self.text_edit, stretch=1)

        self.char_label = QLabel("Caracteres: 0")
        self.char_label.setStyleSheet("color: #888; font-size: 11px;")
        self.text_edit.textChanged.connect(self.update_char_count)
        text_layout.addWidget(self.char_label)
        left_layout.addWidget(text_box, stretch=1)

        # — Sección 3: Pronunciación personalizada ——————————————————————————
        pron_box = QGroupBox("3 · Pronunciación personalizada")
        pron_layout = QVBoxLayout(pron_box)
        pron_layout.setSpacing(4)

        pron_help = QLabel(
            "Palabras o nombres difíciles → cómo deben sonar."
            "  Ej.: Rhyz  →  Rís"
        )
        pron_help.setStyleSheet("color: #666; font-size: 11px;")
        pron_layout.addWidget(pron_help)

        self.pron_table = QTableWidget(0, 2)
        self.pron_table.setHorizontalHeaderLabels(["Texto en el libro", "Cómo debe sonar"])
        self.pron_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.pron_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.pron_table.setMinimumHeight(90)
        self.pron_table.setMaximumHeight(160)
        pron_layout.addWidget(self.pron_table)

        pron_buttons = QHBoxLayout()
        btn_add_pron = QPushButton("+ Agregar")
        btn_add_pron.clicked.connect(lambda: self.add_pronunciation_row("", ""))
        btn_remove_pron = QPushButton("✕ Eliminar seleccionada")
        btn_remove_pron.clicked.connect(self.remove_selected_pronunciation_rows)
        btn_import_excel = QPushButton("📥 Importar Excel")
        btn_import_excel.setToolTip(
            "Importa un archivo .xlsx con dos columnas:\n"
            "  Columna A: Texto tal como aparece en el libro\n"
            "  Columna B: Cómo debe sonar (fonética)\n"
            "Las entradas duplicadas se omiten automáticamente."
        )
        btn_import_excel.clicked.connect(self.import_pronunciation_from_excel)
        pron_buttons.addWidget(btn_add_pron)
        pron_buttons.addWidget(btn_remove_pron)
        pron_buttons.addWidget(btn_import_excel)
        pron_buttons.addStretch(1)
        pron_layout.addLayout(pron_buttons)
        left_layout.addWidget(pron_box)

        splitter.addWidget(left_widget)

        # ════════════════════════════════════════════════════════════════════
        # COLUMNA DERECHA: voz + ajustes + controles de reproducción
        # ════════════════════════════════════════════════════════════════════
        right_scroll = QScrollArea()
        right_scroll.setWidgetResizable(True)
        right_scroll.setFrameShape(right_scroll.Shape.NoFrame)

        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)
        right_layout.setContentsMargins(4, 0, 0, 0)
        right_layout.setSpacing(8)

        # — Sección 4: Voz ——————————————————————————————————————————————————
        voice_box = QGroupBox("4 · Voz neural en español")
        voice_layout = QFormLayout(voice_box)
        voice_layout.setSpacing(6)

        self.gender_combo = QComboBox()
        self.gender_combo.addItems(["Mujer", "Hombre", "Todas"])
        self.gender_combo.currentIndexChanged.connect(self.refresh_voice_combo)

        self.locale_combo = QComboBox()
        self.locale_combo.addItem("Todos los acentos", "ALL")
        self.locale_combo.currentIndexChanged.connect(self.refresh_voice_combo)

        self.voice_combo = QComboBox()

        btn_reload_voices = QPushButton("🔄  Actualizar voces online")
        btn_reload_voices.clicked.connect(self.load_voices_online)

        voice_layout.addRow("Género:", self.gender_combo)
        voice_layout.addRow("Acento / país:", self.locale_combo)
        voice_layout.addRow("Voz:", self.voice_combo)
        voice_layout.addRow("", btn_reload_voices)
        right_layout.addWidget(voice_box)

        # — Sección 5: Ajustes de lectura ————————————————————————————————
        settings_box = QGroupBox("5 · Ajustes de lectura")
        settings_layout = QFormLayout(settings_box)
        settings_layout.setSpacing(8)

        self.rate_slider = QSlider(Qt.Orientation.Horizontal)
        self.rate_slider.setRange(-50, 50)
        self.rate_slider.setValue(0)
        self.rate_label = QLabel("+0%")
        self.rate_label.setFixedWidth(44)
        self.rate_slider.valueChanged.connect(lambda v: self.rate_label.setText(f"{v:+d}%"))
        rate_row = QHBoxLayout()
        rate_row.addWidget(self.rate_slider)
        rate_row.addWidget(self.rate_label)

        self.volume_slider = QSlider(Qt.Orientation.Horizontal)
        self.volume_slider.setRange(-50, 50)
        self.volume_slider.setValue(0)
        self.volume_label = QLabel("+0%")
        self.volume_label.setFixedWidth(44)
        self.volume_slider.valueChanged.connect(lambda v: self.volume_label.setText(f"{v:+d}%"))
        volume_row = QHBoxLayout()
        volume_row.addWidget(self.volume_slider)
        volume_row.addWidget(self.volume_label)

        self.pitch_slider = QSlider(Qt.Orientation.Horizontal)
        self.pitch_slider.setRange(-20, 20)
        self.pitch_slider.setValue(0)
        self.pitch_label = QLabel("+0 Hz")
        self.pitch_label.setFixedWidth(44)
        self.pitch_slider.valueChanged.connect(lambda v: self.pitch_label.setText(f"{v:+d} Hz"))
        pitch_row = QHBoxLayout()
        pitch_row.addWidget(self.pitch_slider)
        pitch_row.addWidget(self.pitch_label)

        self.chunk_spin = QSpinBox()
        self.chunk_spin.setRange(1000, 8000)
        self.chunk_spin.setSingleStep(500)
        self.chunk_spin.setValue(3500)
        self.chunk_spin.setToolTip("Fragmentos más pequeños ayudan con libros muy largos.")

        settings_layout.addRow("Velocidad:", rate_row)
        settings_layout.addRow("Volumen síntesis:", volume_row)
        settings_layout.addRow("Tono:", pitch_row)
        settings_layout.addRow("Tamaño fragmento:", self.chunk_spin)
        right_layout.addWidget(settings_box)

        # — Sección 6: Convertir y reproducir ——————————————————————————————
        action_box = QGroupBox("6 · Convertir y escuchar")
        action_layout = QVBoxLayout(action_box)
        action_layout.setSpacing(8)

        # Botón PLAY grande (acción principal)
        self.btn_play_text = QPushButton("▶  ESCUCHAR texto ahora")
        self.btn_play_text.setMinimumHeight(52)
        self.btn_play_text.setToolTip(
            "Lee en voz alta lo que escribiste o pegaste en el cuadro.\n"
            "No necesitas guardar el MP3 primero."
        )
        self.btn_play_text.setStyleSheet(
            "QPushButton {"
            "  font-size: 15px; font-weight: bold;"
            "  background-color: #2563eb; color: white;"
            "  border-radius: 6px; padding: 10px;"
            "}"
            "QPushButton:hover { background-color: #1d4ed8; }"
            "QPushButton:disabled { background-color: #93c5fd; }"
        )
        self.btn_play_text.clicked.connect(self.preview_written_text)
        action_layout.addWidget(self.btn_play_text)

        # Botones secundarios en una fila
        row_actions = QHBoxLayout()
        row_actions.setSpacing(6)

        self.btn_convert = QPushButton("💾  Guardar MP3")
        self.btn_convert.setToolTip("Convierte el texto completo y elige dónde guardarlo.")
        self.btn_convert.clicked.connect(self.convert_to_speech)

        # btn_preview es un alias interno (referenciado en _start_tts_job)
        self.btn_preview = self.btn_play_text

        self.btn_play = QPushButton("▶  Último MP3")
        self.btn_play.setToolTip("Reproduce el último archivo MP3 generado.")
        self.btn_play.clicked.connect(self.play_audio)

        self.btn_pause = QPushButton("⏸  Pausar")
        self.btn_pause.clicked.connect(self.player.pause)

        self.btn_stop = QPushButton("⏹  Detener")
        self.btn_stop.clicked.connect(self.player.stop)

        row_actions.addWidget(self.btn_convert)
        row_actions.addWidget(self.btn_play)
        row_actions.addWidget(self.btn_pause)
        row_actions.addWidget(self.btn_stop)
        action_layout.addLayout(row_actions)

        # Barra de progreso y estado
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        self.progress.setTextVisible(True)
        action_layout.addWidget(self.progress)

        self.status_label = QLabel("Lista.")
        self.status_label.setStyleSheet("color: #444; font-size: 11px;")
        self.status_label.setWordWrap(True)
        action_layout.addWidget(self.status_label)

        right_layout.addWidget(action_box)
        right_layout.addStretch(1)

        right_scroll.setWidget(right_widget)
        splitter.addWidget(right_scroll)

        # Proporción inicial: 60% izquierda, 40% derecha
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        self.setCentralWidget(root)
        self.add_pronunciation_row("Rhyz", "Rís")

    def show_error(self, title: str, message: str) -> None:
        QMessageBox.critical(self, title, message)

    def show_info(self, title: str, message: str) -> None:
        QMessageBox.information(self, title, message)

    def update_char_count(self) -> None:
        count = len(self.text_edit.toPlainText())
        self.char_label.setText(f"Caracteres: {count:,}".replace(",", "."))

    def add_pronunciation_row(self, written: str = "", spoken: str = "") -> None:
        """Agrega una fila editable con QLineEdit dentro de la tabla.

        Los widgets se registran también en _pron_widgets para poder leerlos
        de forma segura sin depender de cellWidget(), que puede fallar si Qt
        repinta la tabla entre medias (ej. al procesar eventos pendientes).
        """
        if not hasattr(self, "_pron_widgets"):
            self._pron_widgets: List[tuple[QLineEdit, QLineEdit]] = []

        row = self.pron_table.rowCount()
        self.pron_table.insertRow(row)

        written_edit = QLineEdit(written)
        written_edit.setPlaceholderText("Ej.: Rhyz")
        written_edit.setToolTip("Palabra o nombre tal como aparece en el libro.")

        spoken_edit = QLineEdit(spoken)
        spoken_edit.setPlaceholderText("Ej.: Rís")
        spoken_edit.setToolTip("Escríbelo de forma fonética, como quieres que suene.")

        self.pron_table.setCellWidget(row, 0, written_edit)
        self.pron_table.setCellWidget(row, 1, spoken_edit)
        self.pron_table.setRowHeight(row, 36)

        # Registrar directamente los widgets en una lista propia para lectura segura
        self._pron_widgets.append((written_edit, spoken_edit))

    def remove_selected_pronunciation_rows(self) -> None:
        rows = sorted({index.row() for index in self.pron_table.selectedIndexes()}, reverse=True)
        if not rows and self.pron_table.rowCount() > 0:
            rows = [self.pron_table.rowCount() - 1]
        for row in rows:
            self.pron_table.removeRow(row)
            if hasattr(self, "_pron_widgets") and row < len(self._pron_widgets):
                self._pron_widgets.pop(row)

    def import_pronunciation_from_excel(self) -> None:
        """Importa reglas de pronunciación desde un archivo .xlsx.

        Espera un archivo Excel con al menos dos columnas:
          Columna A (índice 0): Texto tal como aparece en el libro.
          Columna B (índice 1): Cómo debe sonar (pronunciación fonética).

        La primera fila puede ser un encabezado; si ambas celdas contienen texto
        y la fila no tiene el aspecto de encabezado (ej. Texto/Fonética), se
        importará como una regla normal.
        Entradas duplicadas (mismo texto escrito) se omiten.
        """
        try:
            import openpyxl  # noqa: PLC0415
        except ImportError:
            self.show_error(
                "Falta openpyxl",
                "Para importar Excel instala openpyxl:\n\n"
                "    python -m pip install openpyxl\n\n"
                "Después vuelve a intentarlo.",
            )
            return

        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Importar diccionario desde Excel",
            "",
            "Excel (*.xlsx *.xlsm);;Todos los archivos (*.*)",
        )
        if not file_path:
            return

        try:
            wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            wb.close()
        except Exception as exc:  # noqa: BLE001
            self.show_error("Error al leer Excel", str(exc))
            return

        if not rows:
            self.show_info("Sin datos", "El archivo Excel está vacío.")
            return

        # Detectar si la primera fila es encabezado: si ambas celdas son cadenas
        # y contienen palabras típicas de encabezado, la saltamos.
        _HEADER_HINTS = {"texto", "escrito", "libro", "nombre", "palabra",
                         "fonética", "fonetica", "sonar", "pronuncia", "spoken", "written"}
        start_index = 0
        first = rows[0]
        if (
            first
            and len(first) >= 2
            and isinstance(first[0], str)
            and isinstance(first[1], str)
            and (
                str(first[0]).strip().lower() in _HEADER_HINTS
                or str(first[1]).strip().lower() in _HEADER_HINTS
            )
        ):
            start_index = 1  # saltar encabezado

        # Recopilar entradas ya existentes para evitar duplicados.
        existing_written: set[str] = set()
        if hasattr(self, "_pron_widgets"):
            for we, _ in self._pron_widgets:
                val = we.text().strip().lower()
                if val:
                    existing_written.add(val)

        imported = 0
        skipped = 0
        for row in rows[start_index:]:
            if not row or len(row) < 2:
                continue
            written = str(row[0]).strip() if row[0] is not None else ""
            spoken = str(row[1]).strip() if row[1] is not None else ""
            if not written or not spoken:
                continue
            if written.lower() in existing_written:
                skipped += 1
                continue
            self.add_pronunciation_row(written, spoken)
            existing_written.add(written.lower())
            imported += 1

        if imported == 0 and skipped == 0:
            self.show_info("Sin datos válidos",
                           "No se encontraron filas válidas con dos columnas de texto.")
        elif imported == 0:
            self.show_info("Sin nuevas entradas",
                           f"Todas las entradas del Excel ({skipped}) ya estaban en el diccionario.")
        else:
            msg = f"Se importaron {imported} entrada(s) al diccionario."
            if skipped:
                msg += f"\n{skipped} entrada(s) duplicada(s) fueron omitidas."
            self.show_info("Importación completada", msg)

    def get_pronunciation_rules(self) -> List[tuple[str, str]]:
        """Lee las reglas de pronunciación directamente desde los QLineEdit registrados.

        NO usa cellWidget() ni processEvents() — ambos pueden fallar cuando
        Qt está en medio de un repintado de la tabla (ej. justo después de
        cargar un archivo que dispara setPlainText y encola eventos de repaint).

        En cambio, lee directamente de _pron_widgets, una lista Python que
        siempre está sincronizada con la tabla y no depende del estado visual de Qt.
        """
        rules: List[tuple[str, str]] = []

        if not hasattr(self, "_pron_widgets"):
            return rules

        for written_edit, spoken_edit in self._pron_widgets:
            written = written_edit.text().strip()
            spoken = spoken_edit.text().strip()
            if written and spoken:
                rules.append((written, spoken))

        return rules

    def open_file(self) -> None:
        filters = (
            "Archivos de texto/ebook (*.txt *.md *.epub *.pdf *.docx *.html *.htm *.csv *.srt *.vtt *.rtf);;"
            "Todos los archivos (*.*)"
        )
        file_path, _ = QFileDialog.getOpenFileName(self, "Abrir archivo", "", filters)
        if not file_path:
            return
        try:
            self.status_label.setText("Leyendo archivo...")
            QApplication.processEvents()
            text = extract_text_from_file(file_path)
            self.current_file = file_path
            self.file_line.setText(file_path)
            self.text_edit.setPlainText(text)
            self.status_label.setText("Archivo cargado correctamente.")
        except Exception as exc:  # noqa: BLE001
            self.status_label.setText("No se pudo cargar el archivo.")
            self.show_error("Error al abrir archivo", str(exc))

    # Voz preferida por defecto
    PREFERRED_VOICE = "es-CR-JuanNeural"

    def _load_fallback_voices(self) -> None:
        """Voces conocidas para que la app tenga opciones aunque falle la lista online."""
        self.all_voices = [
            # Costa Rica (voz preferida por defecto)
            {"ShortName": "es-CR-JuanNeural", "Gender": "Male", "Locale": "es-CR", "FriendlyName": "Microsoft Juan Online (Natural) - Spanish (Costa Rica)"},
            {"ShortName": "es-CR-MariaNeural", "Gender": "Female", "Locale": "es-CR", "FriendlyName": "Microsoft Maria Online (Natural) - Spanish (Costa Rica)"},
            # España
            {"ShortName": "es-ES-ElviraNeural", "Gender": "Female", "Locale": "es-ES", "FriendlyName": "Microsoft Elvira Online (Natural) - Spanish (Spain)"},
            {"ShortName": "es-ES-AlvaroNeural", "Gender": "Male", "Locale": "es-ES", "FriendlyName": "Microsoft Alvaro Online (Natural) - Spanish (Spain)"},
            # México
            {"ShortName": "es-MX-DaliaNeural", "Gender": "Female", "Locale": "es-MX", "FriendlyName": "Microsoft Dalia Online (Natural) - Spanish (Mexico)"},
            {"ShortName": "es-MX-JorgeNeural", "Gender": "Male", "Locale": "es-MX", "FriendlyName": "Microsoft Jorge Online (Natural) - Spanish (Mexico)"},
            # Argentina
            {"ShortName": "es-AR-ElenaNeural", "Gender": "Female", "Locale": "es-AR", "FriendlyName": "Microsoft Elena Online (Natural) - Spanish (Argentina)"},
            {"ShortName": "es-AR-TomasNeural", "Gender": "Male", "Locale": "es-AR", "FriendlyName": "Microsoft Tomas Online (Natural) - Spanish (Argentina)"},
            # Colombia
            {"ShortName": "es-CO-SalomeNeural", "Gender": "Female", "Locale": "es-CO", "FriendlyName": "Microsoft Salome Online (Natural) - Spanish (Colombia)"},
            {"ShortName": "es-CO-GonzaloNeural", "Gender": "Male", "Locale": "es-CO", "FriendlyName": "Microsoft Gonzalo Online (Natural) - Spanish (Colombia)"},
        ]
        self.rebuild_locale_combo()
        self._try_select_preferred_voice()

    def _try_select_preferred_voice(self) -> None:
        """Intenta seleccionar la voz preferida (es-CR-JuanNeural) en los combos."""
        # Buscar si la voz preferida está disponible en la lista actual
        preferred_in_voices = any(
            v.get("ShortName") == self.PREFERRED_VOICE for v in self.all_voices
        )
        if not preferred_in_voices:
            self.refresh_voice_combo()
            return

        # Seleccionar género y locale correctos para la voz preferida
        preferred = next(
            v for v in self.all_voices if v.get("ShortName") == self.PREFERRED_VOICE
        )
        gender_label = "Hombre" if preferred.get("Gender", "").lower() == "male" else "Mujer"
        locale = preferred.get("Locale", "")

        # Poner género
        idx_gender = self.gender_combo.findText(gender_label)
        if idx_gender >= 0:
            self.gender_combo.blockSignals(True)
            self.gender_combo.setCurrentIndex(idx_gender)
            self.gender_combo.blockSignals(False)

        # Poner locale
        self.rebuild_locale_combo()  # asegura que esté el locale en el combo
        idx_locale = self.locale_combo.findData(locale)
        if idx_locale >= 0:
            self.locale_combo.blockSignals(True)
            self.locale_combo.setCurrentIndex(idx_locale)
            self.locale_combo.blockSignals(False)

        # Rellenar el combo de voz y seleccionar la preferida
        self.refresh_voice_combo()
        idx_voice = self.voice_combo.findData(self.PREFERRED_VOICE)
        if idx_voice >= 0:
            self.voice_combo.setCurrentIndex(idx_voice)


    def load_voices_online(self) -> None:
        if edge_tts is None:
            self.status_label.setText("Falta edge-tts. Instala con: python -m pip install edge-tts")
            return

        if self._voices_thread is not None and self._voices_thread.isRunning():
            return

        self.status_label.setText("Cargando voces neuronales en español...")
        self._voices_thread = QThread(self)
        self._voices_worker = VoicesWorker()
        self._voices_worker.moveToThread(self._voices_thread)
        self._voices_thread.started.connect(self._voices_worker.run)
        self._voices_worker.finished.connect(self.on_voices_loaded)
        self._voices_worker.error.connect(self.on_voices_error)
        self._voices_worker.finished.connect(self._voices_thread.quit)
        self._voices_worker.error.connect(self._voices_thread.quit)
        self._voices_thread.finished.connect(self._voices_worker.deleteLater)
        self._voices_thread.finished.connect(self._voices_thread.deleteLater)
        self._voices_thread.start()

    def on_voices_loaded(self, voices: List[Dict[str, str]]) -> None:
        spanish_voices = [v for v in voices if str(v.get("Locale", "")).lower().startswith("es-")]
        if spanish_voices:
            self.all_voices = sorted(
                spanish_voices,
                key=lambda v: (str(v.get("Locale", "")), str(v.get("Gender", "")), str(v.get("ShortName", ""))),
            )
            self.rebuild_locale_combo()
            self._try_select_preferred_voice()
            self.status_label.setText(f"Voces cargadas: {len(spanish_voices)} voces en español.")
        else:
            self.status_label.setText("No encontré voces en español; usando voces predeterminadas.")

    def on_voices_error(self, message: str) -> None:
        self.status_label.setText("No pude actualizar voces online; se usan las predeterminadas.")
        # No mostramos popup para no interrumpir: la app sigue funcionando con presets.
        print("Error cargando voces:", message)

    def rebuild_locale_combo(self) -> None:
        current = self.locale_combo.currentData() if self.locale_combo.count() else "ALL"
        self.locale_combo.blockSignals(True)
        self.locale_combo.clear()
        self.locale_combo.addItem("Todos los acentos", "ALL")

        locales = sorted({str(v.get("Locale", "")) for v in self.all_voices if str(v.get("Locale", "")).startswith("es-")})
        for locale in locales:
            self.locale_combo.addItem(locale, locale)

        index = self.locale_combo.findData(current)
        self.locale_combo.setCurrentIndex(index if index >= 0 else 0)
        self.locale_combo.blockSignals(False)

    def refresh_voice_combo(self) -> None:
        wanted_gender = self.gender_combo.currentText()
        wanted_locale = self.locale_combo.currentData() if self.locale_combo.count() else "ALL"

        self.voice_combo.clear()
        for voice in self.all_voices:
            short_name = str(voice.get("ShortName", ""))
            gender = str(voice.get("Gender", ""))
            locale = str(voice.get("Locale", ""))
            friendly = str(voice.get("FriendlyName", short_name))

            if not locale.lower().startswith("es-"):
                continue
            if wanted_locale != "ALL" and locale != wanted_locale:
                continue
            if wanted_gender == "Mujer" and gender.lower() != "female":
                continue
            if wanted_gender == "Hombre" and gender.lower() != "male":
                continue

            etiqueta_genero = "Mujer" if gender.lower() == "female" else "Hombre" if gender.lower() == "male" else gender
            label = f"{short_name}  ·  {etiqueta_genero}  ·  {locale}"
            if friendly and friendly != short_name:
                label += f"  ·  {friendly}"
            self.voice_combo.addItem(label, short_name)

        if self.voice_combo.count() == 0:
            self.voice_combo.addItem("No hay voces para este filtro", "")

    def _start_tts_job(
        self,
        *,
        text: str,
        output_path: str,
        auto_play: bool,
        show_popup: bool,
    ) -> None:
        """Inicia una conversión TTS compartida por guardar MP3 y por prueba rápida."""
        self.auto_play_after_tts = auto_play
        self.show_popup_after_tts = show_popup
        self.btn_convert.setEnabled(False)
        self.btn_play_text.setEnabled(False)
        self.progress.setValue(0)
        self.status_label.setText("Preparando conversión. Se aplicará el diccionario de pronunciación...")


        self._tts_thread = QThread(self)
        self._tts_worker = TTSWorker(
            text=text,
            output_path=output_path,
            voice=self.voice_combo.currentData(),
            rate_percent=self.rate_slider.value(),
            volume_percent=self.volume_slider.value(),
            pitch_hz=self.pitch_slider.value(),
            chunk_chars=self.chunk_spin.value(),
            pronunciation_rules=self.get_pronunciation_rules(),
        )
        self._tts_worker.moveToThread(self._tts_thread)
        self._tts_thread.started.connect(self._tts_worker.run)
        self._tts_worker.status.connect(self.status_label.setText)
        self._tts_worker.progress.connect(self.progress.setValue)
        self._tts_worker.finished.connect(self.on_tts_finished)
        self._tts_worker.error.connect(self.on_tts_error)
        self._tts_worker.finished.connect(self._tts_thread.quit)
        self._tts_worker.error.connect(self._tts_thread.quit)
        self._tts_thread.finished.connect(self._tts_worker.deleteLater)
        self._tts_thread.finished.connect(self._tts_thread.deleteLater)
        self._tts_thread.finished.connect(lambda: self.btn_convert.setEnabled(True))
        self._tts_thread.finished.connect(lambda: self.btn_play_text.setEnabled(True))

        self._tts_thread.start()

    def preview_written_text(self) -> None:
        """Convierte el texto escrito en la caja y lo reproduce de inmediato."""
        text = self.text_edit.toPlainText().strip()
        if not text:
            self.show_error("Sin texto", "Escribe o pega texto en el cuadro para probar la voz.")
            return

        voice = self.voice_combo.currentData()
        if not voice:
            self.show_error("Sin voz", "Selecciona una voz válida.")
            return

        # Para que la prueba sea rápida, usa solo el primer fragmento si el texto es muy largo.
        max_preview_chars = min(self.chunk_spin.value(), 2500)
        preview_text = text[:max_preview_chars].strip()
        if len(text) > max_preview_chars:
            preview_text += "\n\nVista previa recortada para prueba rápida."

        output_path = str(Path(tempfile.gettempdir()) / f"prueba_voz_{uuid.uuid4().hex}.mp3")
        self._start_tts_job(
            text=preview_text,
            output_path=output_path,
            auto_play=True,
            show_popup=False,
        )

    def convert_to_speech(self) -> None:
        text = self.text_edit.toPlainText().strip()
        if not text:
            self.show_error("Sin texto", "Carga un archivo o pega texto antes de convertir.")
            return

        voice = self.voice_combo.currentData()
        if not voice:
            self.show_error("Sin voz", "Selecciona una voz válida.")
            return

        default_name = "texto_a_voz.mp3"
        if self.current_file:
            default_name = f"{Path(self.current_file).stem}_voz.mp3"
        default_path = str(Path.home() / default_name)

        output_path, _ = QFileDialog.getSaveFileName(
            self,
            "Guardar audio MP3",
            default_path,
            "Audio MP3 (*.mp3)",
        )
        if not output_path:
            return
        if not output_path.lower().endswith(".mp3"):
            output_path += ".mp3"

        self._start_tts_job(
            text=text,
            output_path=output_path,
            auto_play=False,
            show_popup=True,
        )

    def on_tts_finished(self, output_path: str) -> None:
        self.current_output = output_path
        self.progress.setValue(100)
        self.player.setSource(QUrl.fromLocalFile(output_path))

        if self.auto_play_after_tts:
            self.status_label.setText("Prueba creada. Reproduciendo texto escrito...")
            self.player.play()
        else:
            self.status_label.setText(f"Audio creado: {output_path}")

        if self.show_popup_after_tts:
            self.show_info("Listo", f"Audio MP3 creado correctamente:\n{output_path}")

        self.auto_play_after_tts = False
        self.show_popup_after_tts = True

    def on_tts_error(self, message: str) -> None:
        self.progress.setValue(0)
        self.status_label.setText("Error durante la conversión.")
        if "Falta edge-tts" in message:
            self.show_error(
                "Falta instalar edge-tts",
                "Para que el botón PLAY y la conversión funcionen, instala edge-tts:\n\n"
                "python -m pip install edge-tts\n\n"
                "Después cierra y vuelve a abrir la app."
            )
        else:
            self.show_error("Error al convertir", message)

    def play_audio(self) -> None:
        if self.current_output and os.path.exists(self.current_output):
            self.player.setSource(QUrl.fromLocalFile(self.current_output))
            self.player.play()
            return

        # Permite abrir un MP3 ya generado.
        audio_path, _ = QFileDialog.getOpenFileName(self, "Abrir MP3", "", "Audio MP3 (*.mp3)")
        if audio_path:
            self.current_output = audio_path
            self.player.setSource(QUrl.fromLocalFile(audio_path))
            self.player.play()


def main() -> None:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.showMaximized()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

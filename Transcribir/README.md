# 🎙️ Transcriptor de Audio AI (PyQt6 - Dark Mode)

Aplicación de escritorio en Python con interfaz **PyQt6 en Modo Oscuro** para transcribir archivos de audio al español utilizando modelos de **Whisper** (`faster-whisper` / `openai-whisper`), con función para **diferenciar hablantes (Hablante 1 y Hablante 2)** y exportar los resultados a formato `.txt`.

---

## ⚡ Características

- 🌙 **Modo Oscuro Premium**: Interfaz moderna basada en PyQt6 QSS.
- 📁 **Arrastrar y Soltar (Drag & Drop)**: Carga tus archivos de audio (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, etc.) arrastrándolos directamente a la aplicación.
- 🗣️ **Diferenciación de Hablantes (Diarización Acústica)**: Distingue de forma 100% offline entre *Hablante 1*, *Hablante 2*, etc., utilizando vectorización espectral y clustering.
- ⚡ **Rápido y eficiente en CPU**: Optimizado mediante `faster-whisper` con fallback automático a `openai-whisper`.
- ⚙️ **Configurable**: Elige la versión del modelo Whisper (`tiny`, `base`, `small`, `medium`) y la cantidad de hablantes.
- 💾 **Exportación a `.txt`**: Guarda las transcripciones con codificación UTF-8 e inclusión de marcas de tiempo `[MM:SS]`.
- 📋 **Acciones rápidas**: Copiar al portapapeles con un clic.

---

## 🚀 Requisitos e Instalación

### 1. Asegúrate de tener instalado Python (3.9+) y FFmpeg
Es necesario contar con `ffmpeg` instalado y disponible en la variable de entorno PATH del sistema para procesar archivos de audio.

### 2. Instalar dependencias necesarias
Ejecuta el siguiente comando en tu terminal dentro del directorio del proyecto:

```bash
pip install -r requirements.txt
```

---

## 💻 Uso de la Aplicación

Ejecuta la aplicación con el siguiente comando:

```bash
python app.py
```

### Instrucciones de uso:
1. **Seleccionar audio**: Arrastra tu archivo de audio a la zona indicada o presiona **"Seleccionar Archivo de Audio"**.
2. **Ajustar opciones**:
   - Modelo recomendando para CPU: `base`.
   - Marca la casilla **"Diferenciar hablantes (Hablante 1 / Hablante 2)"**.
3. **Iniciar Transcripción**: Presiona **"Iniciar Transcripción"** y observa el avance en tiempo real en la barra de progreso.
4. **Guardar resultado**: Una vez completado, puedes presionar **"Guardar en .TXT"** para exportar el texto generado a un archivo en tu computadora.

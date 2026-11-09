/**
 * Módulo de Transcripción de Audio a Texto (Voz a Texto / STT)
 * Basado en Web Speech Recognition API + Web Audio API.
 * 
 * Incluye:
 * - Transcripción en tiempo real desde el micrófono.
 * - Reproductor y asistente de transcripción para archivos de audio (.mp3, .wav, .m4a, .ogg).
 * - Diferenciación de hablantes (Hablante 1 / Hablante 2).
 * - Inserción opcional de marcas de tiempo [MM:SS].
 * - Exportación a archivo .txt y transferencia directa al motor de Texto a Voz.
 */

class AudioTranscriber {
  constructor() {
    // Verificar soporte de SpeechRecognition en el navegador
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.hasSupport = !!SpeechRecognition;
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;

    this.isRecording = false;
    this.isPaused = false;
    this.language = "es-ES";
    this.differentiateSpeakers = true;
    this.includeTimestamps = true;

    // Estado de la transcripción
    this.startTime = null;
    this.timerInterval = null;
    this.elapsedSeconds = 0;
    this.currentSpeaker = 1;
    this.transcriptionEntries = [];
    this.activeAudioFile = null;

    // Callbacks para la UI
    this.onResult = null;
    this.onStateChange = null;
    this.onTimeUpdate = null;
    this.onError = null;

    if (this.recognition) {
      this.initRecognition();
    }
  }

  initRecognition() {
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;

    let finalAccumulated = "";

    this.recognition.onstart = () => {
      this.isRecording = true;
      this.isPaused = false;
      this.startTimer();
      if (this.onStateChange) this.onStateChange({ isRecording: true, isPaused: false });
    };

    this.recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          this.addTranscriptionSegment(transcript.trim());
        } else {
          interim += transcript;
        }
      }

      if (this.onResult) {
        this.onResult({
          fullText: this.getFormattedText(),
          interimText: interim,
          entries: this.transcriptionEntries
        });
      }
    };

    this.recognition.onerror = (event) => {
      console.warn("SpeechRecognition error:", event.error);
      if (this.onError) {
        this.onError(event.error);
      }
    };

    this.recognition.onend = () => {
      // Si se detuvo involuntariamente y el usuario sigue en modo grabación, reiniciar
      if (this.isRecording && !this.isPaused) {
        try {
          this.recognition.start();
        } catch (e) {
          this.stopRecording();
        }
      } else {
        this.stopRecording();
      }
    };
  }

  setLanguage(lang) {
    this.language = lang || "es-ES";
    if (this.recognition) {
      this.recognition.lang = this.language;
    }
  }

  startRecording() {
    if (!this.hasSupport) {
      throw new Error("Tu navegador no soporta SpeechRecognition. Se recomienda Google Chrome o Microsoft Edge.");
    }

    if (this.isRecording) return;

    this.recognition.lang = this.language;
    try {
      this.recognition.start();
    } catch (e) {
      console.error("Error al iniciar reconocimiento:", e);
    }
  }

  stopRecording() {
    this.isRecording = false;
    this.isPaused = false;
    this.stopTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    if (this.onStateChange) {
      this.onStateChange({ isRecording: false, isPaused: false });
    }

    if (this.onResult) {
      this.onResult({
        fullText: this.getFormattedText(),
        interimText: "",
        entries: this.transcriptionEntries
      });
    }
  }

  toggleSpeaker() {
    this.currentSpeaker = this.currentSpeaker === 1 ? 2 : 1;
    return this.currentSpeaker;
  }

  addTranscriptionSegment(text) {
    if (!text) return;

    const timeFormatted = this.formatTime(this.elapsedSeconds);
    const entry = {
      time: timeFormatted,
      seconds: this.elapsedSeconds,
      speaker: this.currentSpeaker,
      text: text
    };

    this.transcriptionEntries.push(entry);

    // Si está habilitada la diferenciación de hablantes en modo alterno,
    // tras un segmento largo o pausa se puede alternar automáticamente si el usuario lo desea.
  }

  getFormattedText() {
    return this.transcriptionEntries
      .map((entry) => {
        let prefix = "";
        if (this.includeTimestamps) {
          prefix += `[${entry.time}] `;
        }
        if (this.differentiateSpeakers) {
          prefix += `Hablante ${entry.speaker}: `;
        }
        return `${prefix}${entry.text}`;
      })
      .join("\n\n");
  }

  clearTranscription() {
    this.stopRecording();
    this.transcriptionEntries = [];
    this.elapsedSeconds = 0;
    this.currentSpeaker = 1;
    if (this.onResult) {
      this.onResult({ fullText: "", interimText: "", entries: [] });
    }
  }

  startTimer() {
    this.stopTimer();
    this.startTime = Date.now() - (this.elapsedSeconds * 1000);
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.formatTime(this.elapsedSeconds));
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  /**
   * Exporta la transcripción a un archivo .txt con codificación UTF-8.
   */
  exportToTxt(filename = "transcripcion_audio.txt") {
    const text = this.getFormattedText();
    if (!text.trim()) {
      throw new Error("No hay texto para guardar en .TXT.");
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * Motor de Transcripción de Archivos de Audio 100% en el Navegador (Web / GitHub Pages)
 * Decodifica cualquier archivo de audio (.mp3, .wav, .m4a, .ogg, .flac, .webm, .aac) a 16kHz Mono
 * mediante Web Audio API y ejecuta Whisper IA en un Web Worker sin depender de servidores externos.
 */
class BrowserWhisperTranscriber {
  constructor() {
    this.worker = null;
    this.jobCounter = 0;
    this.mainThreadPipeline = null;
  }

  static formatSeconds(seconds) {
    const totalSecs = Math.max(0, Math.round(seconds || 0));
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  /**
   * Decodifica un objeto File de audio y lo remuestrea a 16000 Hz Mono Float32Array.
   */
  async decodeAudioFileTo16kHz(file, onEvent) {
    if (onEvent) {
      onEvent({
        type: "status",
        progress: 1,
        message: "Decodificando y preparando audio en tu navegador...",
        current_time: "00:00",
        total_time: "--:--"
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Tu navegador no soporta Web Audio API para decodificar archivos de audio.");
    }

    const tempCtx = new AudioCtx();
    let decodedBuffer;
    try {
      decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      try {
        await tempCtx.close();
      } catch (e) {}
    }

    const targetSampleRate = 16000;
    const duration = decodedBuffer.duration;
    const numSamples = Math.max(1, Math.ceil(duration * targetSampleRate));

    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineCtx) {
      const offlineCtx = new OfflineCtx(1, numSamples, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);
      const renderedBuffer = await offlineCtx.startRendering();
      return new Float32Array(renderedBuffer.getChannelData(0));
    }

    // Fallback manual de remuestreo lineal si OfflineAudioContext no está disponible
    const ch0 = decodedBuffer.getChannelData(0);
    const ch1 = decodedBuffer.numberOfChannels > 1 ? decodedBuffer.getChannelData(1) : null;
    const srcRate = decodedBuffer.sampleRate;
    const out = new Float32Array(numSamples);
    const ratio = srcRate / targetSampleRate;

    for (let i = 0; i < numSamples; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(ch0.length - 1, idx0 + 1);
      const frac = srcIdx - idx0;
      let s0 = ch0[idx0] * (1 - frac) + ch0[idx1] * frac;
      if (ch1) {
        const s1 = ch1[idx0] * (1 - frac) + ch1[idx1] * frac;
        s0 = 0.5 * (s0 + s1);
      }
      out[i] = s0;
    }
    return out;
  }

  _getOrCreateWorker() {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker("js/whisper-worker.js?v=1.2", { type: "module" });
      return this.worker;
    } catch (e) {
      console.warn("No se pudo iniciar Web Worker modular, se usará hilo principal:", e);
      return null;
    }
  }

  /**
   * Transcribe un archivo de audio en el navegador emitiendo eventos en tiempo real
   * idénticos a los de server.py: status, segment, done, error.
   */
  async transcribeFile(file, options = {}, onEvent = () => {}) {
    const language = options.language || "es-CR";
    const diarize = options.diarize !== undefined ? Boolean(options.diarize) : true;
    const timestamps = options.timestamps !== undefined ? Boolean(options.timestamps) : true;

    const audioData = await this.decodeAudioFileTo16kHz(file, onEvent);
    const worker = this._getOrCreateWorker();

    if (worker) {
      const jobId = ++this.jobCounter;
      return new Promise((resolve, reject) => {
        const handleMessage = (e) => {
          const data = e.data;
          if (!data || data.id !== jobId) return;

          if (data.type === "status" || data.type === "segment") {
            onEvent(data);
          } else if (data.type === "done") {
            cleanup();
            onEvent(data);
            resolve(data);
          } else if (data.type === "error") {
            cleanup();
            reject(new Error(data.error || "Error durante la transcripción en el navegador."));
          }
        };

        const handleError = (err) => {
          cleanup();
          // Si el worker falla al cargar el módulo, caer al hilo principal
          this.worker = null;
          this._transcribeInMainThread(audioData, { language, diarize, timestamps }, onEvent)
            .then(resolve)
            .catch(reject);
        };

        const cleanup = () => {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
        };

        worker.addEventListener("message", handleMessage);
        worker.addEventListener("error", handleError);

        // Enviar copia del buffer al Worker
        const audioCopy = new Float32Array(audioData);
        worker.postMessage(
          {
            id: jobId,
            audioData: audioCopy,
            sampleRate: 16000,
            language,
            diarize,
            timestamps
          },
          [audioCopy.buffer]
        );
      });
    }

    return this._transcribeInMainThread(audioData, { language, diarize, timestamps }, onEvent);
  }

  /**
   * Fallback en el hilo principal en caso de que el navegador bloquee Workers modulares (ej. file://)
   */
  async _transcribeInMainThread(audioData, { language, diarize, timestamps }, onEvent) {
    const sampleRate = 16000;
    const totalDuration = Math.max(0.1, audioData.length / sampleRate);
    const totalTimeStr = BrowserWhisperTranscriber.formatSeconds(totalDuration);

    if (!this.mainThreadPipeline) {
      onEvent({
        type: "status",
        progress: 2,
        message: "Inicializando motor Whisper IA en tu navegador...",
        current_time: "00:00",
        total_time: totalTimeStr
      });

      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      this.mainThreadPipeline = await pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
        quantized: true,
        progress_callback: (info) => {
          if (info && info.status === "progress" && typeof info.progress === "number") {
            const pct = Math.min(15, Math.max(2, Math.round(info.progress * 0.15)));
            onEvent({
              type: "status",
              progress: pct,
              message: `Cargando modelo Whisper IA (${Math.round(info.progress)}%)...`,
              current_time: "00:00",
              total_time: totalTimeStr
            });
          }
        }
      });
    }

    const langPrefix = (language || "es").split("-")[0].toLowerCase();
    const whisperLang = langPrefix === "en" ? "english" : "spanish";

    onEvent({
      type: "status",
      progress: 5,
      message: `Iniciando transcripción con Whisper IA (Duración total: ${totalTimeStr})...`,
      current_time: "00:00",
      total_time: totalTimeStr
    });

    const chunkStep = 24 * sampleRate;
    const segmentsRaw = [];

    for (let startSample = 0; startSample < audioData.length; startSample += chunkStep) {
      const endSample = Math.min(audioData.length, startSample + chunkStep);
      const chunkStartSec = startSample / sampleRate;
      const chunkEndSec = endSample / sampleRate;
      const chunkSlice = audioData.subarray(startSample, endSample);

      const result = await this.mainThreadPipeline(chunkSlice, {
        language: whisperLang,
        task: "transcribe",
        return_timestamps: true
      });

      if (result && Array.isArray(result.chunks) && result.chunks.length > 0) {
        for (const sub of result.chunks) {
          const txt = (sub.text || "").trim();
          if (!txt) continue;
          const relStart = Array.isArray(sub.timestamp) && typeof sub.timestamp[0] === "number" ? sub.timestamp[0] : 0;
          const relEnd = Array.isArray(sub.timestamp) && typeof sub.timestamp[1] === "number"
            ? sub.timestamp[1]
            : (chunkEndSec - chunkStartSec);
          segmentsRaw.push({
            start: chunkStartSec + relStart,
            end: Math.min(totalDuration, chunkStartSec + Math.max(relStart + 0.5, relEnd)),
            speaker: "Hablante 1",
            text: txt
          });
        }
      } else if (result && typeof result.text === "string" && result.text.trim()) {
        segmentsRaw.push({
          start: chunkStartSec,
          end: chunkEndSec,
          speaker: "Hablante 1",
          text: result.text.trim()
        });
      }

      const currentFullText = segmentsRaw
        .map((s) => {
          const ts = timestamps ? `[${BrowserWhisperTranscriber.formatSeconds(s.start)}] ` : "";
          const spk = diarize ? `${s.speaker || "Hablante 1"}: ` : "";
          return `${ts}${spk}${s.text}`;
        })
        .join("\n\n");

      const pct = Math.min(98, Math.max(6, Math.round((chunkEndSec / totalDuration) * 100)));
      const currentTimeStr = BrowserWhisperTranscriber.formatSeconds(chunkEndSec);
      const wordCount = currentFullText.trim() ? currentFullText.trim().split(/\s+/).length : 0;

      onEvent({
        type: "segment",
        progress: pct,
        current_time: currentTimeStr,
        total_time: totalTimeStr,
        full_text: currentFullText,
        word_count: wordCount,
        start: chunkStartSec,
        end: chunkEndSec
      });
    }

    const finalFullText = segmentsRaw
      .map((s) => {
        const ts = timestamps ? `[${BrowserWhisperTranscriber.formatSeconds(s.start)}] ` : "";
        const spk = diarize ? `${s.speaker || "Hablante 1"}: ` : "";
        return `${ts}${spk}${s.text}`;
      })
      .join("\n\n");

    const doneEvent = {
      type: "done",
      progress: 100,
      message: "¡Transcripción completada con éxito!",
      full_text: finalFullText,
      segments: segmentsRaw,
      word_count: finalFullText.trim() ? finalFullText.trim().split(/\s+/).length : 0
    };
    onEvent(doneEvent);
    return doneEvent;
  }
}

window.AudioTranscriber = AudioTranscriber;
window.BrowserWhisperTranscriber = BrowserWhisperTranscriber;

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

window.AudioTranscriber = AudioTranscriber;

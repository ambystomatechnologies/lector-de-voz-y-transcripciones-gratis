/**
 * Motor de Síntesis de Voz (TTS Engine)
 * Basado en Web Speech API + Web Audio API.
 * 
 * Incluye:
 * - Segmentación inteligente por oraciones para evitar el bug de corte de Chrome/Safari.
 * - Sincronización visual en tiempo real de la frase que se está leyendo.
 * - Soporte para voces en español de todos los países.
 * - Filtro fonético personalizado en tiempo real antes de enviar cada frase al sintetizador.
 * - Control total: Play, Pausa, Reanudar, Detener, Frase Siguiente y Frase Anterior.
 * - Grabación / exportación de audio cuando el navegador lo soporta.
 */

class TTSEngine {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.selectedVoice = null;
    this.selectedLocale = "es-CR";
    this.selectedGender = "Hombre";
    this.rate = 1.0;
    this.pitch = 1.0;
    this.volume = 1.0;

    // Estado de lectura
    this.sentences = [];
    this.originalSentences = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentUtterance = null;
    this.keepAliveTimer = null;

    // Soporte para Servidor Local con edge-tts (Voces Neurales de Alta Calidad)
    this.useNeuralServer = false;
    this.selectedVoiceName = "es-CR-JuanNeural";
    this.audioElement = new Audio();

    // Callbacks para la UI
    this.onSentenceStart = null;
    this.onSentenceEnd = null;
    this.onFinish = null;
    this.onStateChange = null;
    this.onVoicesLoaded = null;

    this.checkServerStatus();
    this.initVoices();
  }

  /**
   * Comprueba si el servidor local de edge-tts está disponible.
   */
  async checkServerStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data && data.status === "ok" && data.has_edge_tts) {
        this.useNeuralServer = true;
        console.log("✓ Servidor neural edge-tts activo. Se usarán voces naturales de alta fidelidad.");
      }
    } catch (e) {
      this.useNeuralServer = false;
      console.log("ℹ Servidor Python local no detectado, usando Web Speech API del navegador.");
    }
  }

  /**
   * Carga y filtra las voces disponibles del sistema / navegador.
   */
  initVoices() {
    const loadVoices = () => {
      if (!this.synth) return;
      const all = this.synth.getVoices();
      if (all && all.length > 0) {
        this.voices = all;
        if (this.onVoicesLoaded) {
          this.onVoicesLoaded(this.getSpanishVoices());
        }
      }
    };

    loadVoices();
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  /**
   * Devuelve las voces en español filtradas y ordenadas por calidad.
   */
  getSpanishVoices() {
    const spanish = this.voices.filter((v) => {
      const lang = (v.lang || "").toLowerCase();
      return lang.startsWith("es") || lang.includes("spanish") || (v.name && v.name.toLowerCase().includes("spanish"));
    });

    // Si no hay voces específicas en español, devolver todas
    if (spanish.length === 0) return this.voices;

    // Ordenar: voces Naturales/Online primero, luego por nombre
    return spanish.sort((a, b) => {
      const aNat = (a.name || "").toLowerCase().includes("natural") || (a.name || "").toLowerCase().includes("online");
      const bNat = (b.name || "").toLowerCase().includes("natural") || (b.name || "").toLowerCase().includes("online");
      if (aNat && !bNat) return -1;
      if (!aNat && bNat) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Selecciona una voz por su URI o nombre, asignando acento y género.
   */
  setVoice(voiceUriOrName, locale, gender) {
    if (locale) this.selectedLocale = locale;
    if (gender) this.selectedGender = gender;
    if (voiceUriOrName) this.selectedVoiceName = voiceUriOrName;
    if (!voiceUriOrName) return;

    // 1. Intentar encontrar coincidencia directa por URI o nombre
    let found = this.voices.find(
      (v) => v.voiceURI === voiceUriOrName || v.name === voiceUriOrName
    );

    // 2. Si no se encuentra (ej. ID de voz virtual de catálogo), buscar la mejor voz disponible del navegador que coincida con el género
    if (!found) {
      const spVoices = this.getSpanishVoices();
      const maleKeywords = ["pablo", "raul", "jorge", "tomas", "gonzalo", "lorenzo", "marcelo", "manuel", "emilio", "luis", "rodrigo", "javier", "andres", "carlos", "federico", "roberto", "mario", "alex", "victor", "alonso", "mateo", "sebastian", "david", "male", "hombre"];
      const femaleKeywords = ["helena", "laura", "sabina", "maria", "elvira", "dalia", "elena", "salome", "catalina", "sofia", "belkys", "ramona", "andrea", "lorena", "teresa", "marta", "karla", "yolanda", "margarita", "tania", "camila", "karina", "paloma", "valentina", "paola", "monica", "female", "mujer"];

      if (this.selectedGender === "Hombre") {
        found = spVoices.find(v => maleKeywords.some(kw => v.name.toLowerCase().includes(kw)));
      } else if (this.selectedGender === "Mujer") {
        found = spVoices.find(v => femaleKeywords.some(kw => v.name.toLowerCase().includes(kw)));
      }

      if (!found && spVoices.length > 0) {
        found = spVoices[0];
      }
    }

    if (found) {
      this.selectedVoice = found;
    }
  }

  /**
   * Divide el texto en oraciones respetando la puntuación para lectura fluida.
   * Convierte guiones en espacios para evitar deletreo según el requerimiento.
   */
  splitIntoSentences(text) {
    if (!text) return [];
    
    // Normalizar texto y reemplazar guiones y barras bajas por espacios
    let clean = text.replace(/[-—–_]/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    
    // Separar por saltos de línea de párrafos o signos de puntuación (. ! ? ; :)
    // Manteniendo la estructura para lectura natural
    const rawBlocks = clean.split(/\n\s*\n/);
    const result = [];

    for (const block of rawBlocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;

      // Dividir el bloque en oraciones usando puntuación
      // Regex segura que detecta finales de frase considerando signos en español (¿ ¡ . ! ? :)
      const sentences = trimmedBlock.match(/[^.!?¿¡;:\n]+[.!?¿¡;:\n]*/g) || [trimmedBlock];

      for (let s of sentences) {
        s = s.trim();
        if (s.length > 0) {
          result.push(s);
        }
      }
    }

    return result;
  }

  /**
   * Prepara el texto para iniciar la reproducción.
   */
  loadText(fullText) {
    this.stop();
    this.originalSentences = this.splitIntoSentences(fullText);
    this.sentences = [...this.originalSentences];
    this.currentIndex = 0;
  }

  /**
   * Inicia la lectura desde la frase indicada (o desde el principio).
   */
  play(startIndex = 0) {
    if (!this.synth) {
      alert("Tu navegador no soporta síntesis de voz (Web Speech API).");
      return;
    }

    if (this.sentences.length === 0) {
      return;
    }

    if (this.isPaused && this.currentIndex === startIndex) {
      if (this.useNeuralServer && this.audioElement && this.audioElement.src) {
        this.audioElement.play().catch(e => console.warn(e));
      } else if (this.synth) {
        this.synth.resume();
      }
      this.isPaused = false;
      this.isPlaying = true;
      this._notifyState();
      return;
    }

    if (this.useNeuralServer && this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = "";
    }
    if (this.synth) {
      this.synth.cancel();
    }

    this.currentIndex = Math.max(0, Math.min(startIndex, this.sentences.length - 1));
    this.isPlaying = true;
    this.isPaused = false;
    this._startKeepAlive();
    this._notifyState();

    this._speakCurrentSentence();
  }

  /**
   * Pausa la lectura.
   */
  pause() {
    if (this.isPlaying && !this.isPaused) {
      if (this.useNeuralServer && this.audioElement) {
        this.audioElement.pause();
      } else if (this.synth) {
        this.synth.pause();
      }
      this.isPaused = true;
      this.isPlaying = false;
      this._notifyState();
    }
  }

  /**
   * Reanuda la lectura.
   */
  resume() {
    if (this.isPaused) {
      if (this.useNeuralServer && this.audioElement && this.audioElement.src) {
        this.audioElement.play().catch(e => console.warn(e));
      } else if (this.synth) {
        this.synth.resume();
      }
      this.isPaused = false;
      this.isPlaying = true;
      this._notifyState();
    } else if (!this.isPlaying && this.sentences.length > 0) {
      this.play(this.currentIndex);
    }
  }

  /**
   * Detiene por completo la lectura y resetea el cursor.
   */
  stop() {
    if (this.useNeuralServer && this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = "";
    }
    if (this.synth) {
      this.synth.cancel();
    }
    this._stopKeepAlive();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentUtterance = null;
    this._notifyState();
  }

  /**
   * Salta a la siguiente frase.
   */
  nextSentence() {
    if (this.currentIndex < this.sentences.length - 1) {
      this.currentIndex++;
      if (this.isPlaying) {
        if (this.useNeuralServer && this.audioElement) {
          this.audioElement.pause();
          this.audioElement.src = "";
        }
        if (this.synth) this.synth.cancel();
        this._speakCurrentSentence();
      } else {
        this._notifySentenceChange();
      }
    }
  }

  /**
   * Regresa a la frase anterior.
   */
  previousSentence() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      if (this.isPlaying) {
        if (this.useNeuralServer && this.audioElement) {
          this.audioElement.pause();
          this.audioElement.src = "";
        }
        if (this.synth) this.synth.cancel();
        this._speakCurrentSentence();
      } else {
        this._notifySentenceChange();
      }
    }
  }

  /**
   * Lee la frase en la posición `this.currentIndex` aplicando el diccionario fonético.
   */
  _speakCurrentSentence() {
    if (!this.isPlaying || this.currentIndex >= this.sentences.length) {
      this.isPlaying = false;
      this.isPaused = false;
      this._stopKeepAlive();
      this._notifyState();
      if (this.onFinish) this.onFinish();
      return;
    }

    const rawSentence = this.sentences[this.currentIndex];
    
    // Aplicar las reglas de pronunciación personalizada si están disponibles
    let phoneticSentence = rawSentence;
    if (window.pronunciationManager) {
      phoneticSentence = window.pronunciationManager.applyRules(rawSentence);
    }

    // Reemplazar guiones por espacios (ej. "audio-textos" -> "audio textos") para evitar deletreo
    phoneticSentence = phoneticSentence.replace(/[-—–_]/g, " ");

    if (this.useNeuralServer) {
      // Asegurarse de que el sintetizador del navegador esté 100% cancelado y mudo
      if (this.synth) {
        this.synth.cancel();
      }
      this._speakWithNeuralServer(rawSentence, phoneticSentence);
    } else {
      this._speakWithBrowserSynth(rawSentence, phoneticSentence);
    }
  }

  /**
   * Reproduce la frase utilizando el servidor local de edge-tts con voces neuronales idénticas a Python.
   */
  async _speakWithNeuralServer(rawSentence, phoneticSentence) {
    // Desvincular eventos del audio anterior para que no disparen errores al reiniciar
    if (this.audioElement) {
      this.audioElement.onended = null;
      this.audioElement.onerror = null;
      this.audioElement.pause();
    }

    // Cancelar cualquier síntesis de voz nativa del navegador para evitar voces simultáneas
    if (this.synth) {
      this.synth.cancel();
    }

    if (this.onSentenceStart) {
      this.onSentenceStart({
        index: this.currentIndex,
        total: this.sentences.length,
        rawText: rawSentence,
        phoneticText: phoneticSentence,
        percent: Math.round(((this.currentIndex + 1) / this.sentences.length) * 100)
      });
    }

    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: phoneticSentence,
          voice: this.selectedVoiceName || "es-CR-JuanNeural",
          rate: this.rate,
          pitch: this.pitch,
          volume: this.volume
        })
      });

      if (!resp.ok) {
        throw new Error(`HTTP error ${resp.status}`);
      }

      const blob = await resp.blob();
      const audioUrl = URL.createObjectURL(blob);

      this.audioElement.src = audioUrl;
      this.audioElement.volume = Math.max(0, Math.min(1, this.volume));

      this.audioElement.onended = () => {
        URL.revokeObjectURL(audioUrl);
        if (this.onSentenceEnd) {
          this.onSentenceEnd({ index: this.currentIndex });
        }
        if (this.isPlaying) {
          this.currentIndex++;
          this._speakCurrentSentence();
        }
      };

      this.audioElement.onerror = (e) => {
        console.warn("Error en reproducción de audio neural:", e);
        URL.revokeObjectURL(audioUrl);
        // Si se detuvo intencionalmente, no continuar
        if (!this.isPlaying) return;
        this.currentIndex++;
        this._speakCurrentSentence();
      };

      await this.audioElement.play();
    } catch (err) {
      console.warn("Error en solicitud /api/tts:", err);
      // No llamar a _speakWithBrowserSynth para evitar voz robótica doble
      if (this.isPlaying) {
        this.currentIndex++;
        setTimeout(() => this._speakCurrentSentence(), 300);
      }
    }
  }

  /**
   * Fallback a Web Speech API del navegador (solo si el servidor neural NO está disponible).
   */
  _speakWithBrowserSynth(rawSentence, phoneticSentence) {
    // Si el servidor neural está activo, JAMÁS reproducir la voz robótica nativa
    if (this.useNeuralServer) {
      if (this.synth) this.synth.cancel();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(phoneticSentence);
    this.currentUtterance = utterance;

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
    } else {
      const spVoices = this.getSpanishVoices();
      if (spVoices.length > 0) {
        utterance.voice = spVoices[0];
      }
    }

    if (this.selectedLocale) {
      utterance.lang = this.selectedLocale;
    }

    // Cálculo del tono efectivo según el tono del usuario y el género
    let effectivePitch = this.pitch;
    if (this.selectedGender === "Hombre") {
      effectivePitch = effectivePitch * 0.82;
    } else if (this.selectedGender === "Mujer") {
      effectivePitch = effectivePitch * 1.18;
    }

    utterance.rate = Math.max(0.5, Math.min(2.0, this.rate));
    utterance.pitch = Math.max(0.2, Math.min(2.0, effectivePitch));
    utterance.volume = Math.max(0.0, Math.min(1.0, this.volume));

    utterance.onstart = () => {
      if (this.onSentenceStart) {
        this.onSentenceStart({
          index: this.currentIndex,
          total: this.sentences.length,
          rawText: rawSentence,
          phoneticText: phoneticSentence,
          percent: Math.round(((this.currentIndex + 1) / this.sentences.length) * 100)
        });
      }
    };

    utterance.onend = () => {
      if (this.onSentenceEnd) {
        this.onSentenceEnd({ index: this.currentIndex });
      }

      if (this.isPlaying) {
        this.currentIndex++;
        this._speakCurrentSentence();
      }
    };

    utterance.onerror = (event) => {
      if (event.error !== "canceled" && event.error !== "interrupted") {
        console.warn("SpeechSynthesis error:", event);
      }
      if (this.isPlaying) {
        this.currentIndex++;
        this._speakCurrentSentence();
      }
    };

    if (this.synth) {
      this.synth.speak(utterance);
    }
  }

  /**
   * Reinicia inmediatamente la frase actual con nuevos ajustes (voz, tono, velocidad).
   */
  restartCurrentSentence() {
    if (this.useNeuralServer && this.audioElement) {
      this.audioElement.onended = null;
      this.audioElement.onerror = null;
      this.audioElement.pause();
    }
    if (this.synth) {
      this.synth.cancel();
    }
    if (this.isPlaying && !this.isPaused) {
      this._speakCurrentSentence();
    }
  }

  /**
   * Previene que navegadores con Web Speech API pausen la lectura a los 14 segundos.
   */
  _startKeepAlive() {
    this._stopKeepAlive();
    // No se necesita keepalive de síntesis cuando se usa el reproductor de audio neural HTML5
    if (this.useNeuralServer) return;

    this.keepAliveTimer = setInterval(() => {
      if (this.isPlaying && !this.isPaused && this.synth && this.synth.speaking) {
        this.synth.pause();
        this.synth.resume();
      }
    }, 10000);
  }

  _stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  _notifyState() {
    if (this.onStateChange) {
      this.onStateChange({
        isPlaying: this.isPlaying,
        isPaused: this.isPaused,
        currentIndex: this.currentIndex,
        total: this.sentences.length
      });
    }
  }

  _notifySentenceChange() {
    if (this.onSentenceStart && this.sentences.length > 0) {
      const raw = this.sentences[this.currentIndex];
      this.onSentenceStart({
        index: this.currentIndex,
        total: this.sentences.length,
        rawText: raw,
        phoneticText: window.pronunciationManager ? window.pronunciationManager.applyRules(raw) : raw,
        percent: Math.round(((this.currentIndex + 1) / this.sentences.length) * 100)
      });
    }
    this._notifyState();
  }
}

window.TTSEngine = TTSEngine;

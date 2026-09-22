/**
 * AudioExport - Generador y Descargador de Archivos de Audio WAV
 * Opera 100% en el cliente (navegador) para compatibilidad total con GitHub Pages.
 * 
 * Aplica:
 * - Corrección fonética personalizada del diccionario (ej. apple -> apel).
 * - Tratamiento de guiones como espacios (ej. audio-textos -> audio textos).
 * - Modulación de tono (pitch) según género (Hombre: fundamental baja ~115Hz, Mujer: fundamental alta ~220Hz).
 * - Factor de tono del slider (0.5 a 1.5).
 * - Factor de velocidad (rate) del slider (0.5x a 2.0x).
 * - Salida en formato estándar RIFF/WAVE PCM 16-bit a 22050 Hz Mono.
 */

(function () {
  class AudioExporter {
    constructor() {
      this.sampleRate = 22050; // 22.05 kHz para síntesis óptima en navegador
    }

    /**
     * Codifica muestras Float32Array (-1.0 a 1.0) en un ArrayBuffer WAV PCM 16-bit.
     */
    encodeWAV(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);

      // Helper para escribir strings ASCII
      function writeString(offset, string) {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      }

      /* RIFF identifier */
      writeString(0, "RIFF");
      /* file length */
      view.setUint32(4, 36 + samples.length * 2, true);
      /* RIFF type */
      writeString(8, "WAVE");
      /* format chunk identifier */
      writeString(12, "fmt ");
      /* format chunk length */
      view.setUint32(16, 16, true);
      /* sample format (raw PCM) */
      view.setUint16(20, 1, true);
      /* channel count (mono) */
      view.setUint16(22, 1, true);
      /* sample rate */
      view.setUint32(24, sampleRate, true);
      /* byte rate (sample rate * block align) */
      view.setUint32(28, sampleRate * 2, true);
      /* block align (channel count * bytes per sample) */
      view.setUint16(32, 2, true);
      /* bits per sample */
      view.setUint16(34, 16, true);
      /* data chunk identifier */
      writeString(36, "data");
      /* data chunk length */
      view.setUint32(40, samples.length * 2, true);

      // Escribir muestras PCM de 16 bits
      let offset = 44;
      for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }

      return buffer;
    }

    /**
     * Genera una forma de onda armónica vocal para un fonema/sílaba
     * usando síntesis de formantes (vocal tract model).
     */
    synthesizePhoneme(char, f0, durationSec, sampleRate, isVowel) {
      const numSamples = Math.floor(durationSec * sampleRate);
      const output = new Float32Array(numSamples);

      // Formantes aproximados de vocales en español (F1, F2 en Hz)
      const formants = {
        a: [800, 1200],
        e: [500, 1800],
        i: [300, 2200],
        o: [500, 900],
        u: [350, 750]
      };

      const fTuple = formants[char] || [500, 1400];
      const f1 = fTuple[0];
      const f2 = fTuple[1];

      let phase = 0;
      const twoPi = Math.PI * 2;

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Envolvente de amplitud trapezoidal (fade in / fade out suave)
        const attack = Math.min(1, i / (0.02 * sampleRate));
        const decay = Math.min(1, (numSamples - i) / (0.03 * sampleRate));
        const env = attack * decay;

        // Onda fuente glotal con armónicos
        phase += (twoPi * f0) / sampleRate;
        if (phase > twoPi) phase -= twoPi;

        let val = 0;
        if (isVowel) {
          // Resonancia formántica simulada
          const h1 = Math.sin(phase);
          const h2 = 0.5 * Math.sin(phase * 2);
          const h3 = 0.25 * Math.sin(phase * 3);
          const f1Wave = 0.4 * Math.sin(twoPi * f1 * t);
          const f2Wave = 0.2 * Math.sin(twoPi * f2 * t);
          val = (h1 + h2 + h3 + f1Wave + f2Wave) * 0.35;
        } else {
          // Consonante: mezcla armónica con ruido suave
          const noise = (Math.random() * 2 - 1) * 0.15;
          const tone = 0.25 * Math.sin(phase * 1.5);
          val = (tone + noise) * 0.4;
        }

        output[i] = val * env;
      }

      return output;
    }

    /**
     * Convierte texto a un Blob WAV con los parámetros de voz y fonética indicados.
     */
    generateWavFromText(text, options = {}) {
      const gender = options.gender || "Hombre";
      const pitchMultiplier = options.pitch || 1.0;
      const rateMultiplier = options.rate || 1.0;
      const pronManager = options.pronManager || window.pronunciationManager;

      // 1. Aplicar reglas del diccionario fonético si está disponible
      let processed = text;
      if (pronManager && pronManager.applyRules) {
        processed = pronManager.applyRules(text);
      }

      // 2. Reemplazar guiones por espacios para que no se deletreen
      processed = processed.replace(/[-—–_]/g, " ");
      processed = processed.replace(/\s+/g, " ").trim();

      if (!processed) {
        throw new Error("No hay texto para generar el archivo de audio.");
      }

      // Frecuencia fundamental base según género y tono
      const baseF0 = gender === "Hombre" ? 120 : 215;
      const f0 = Math.max(60, Math.min(400, baseF0 * pitchMultiplier));

      // Velocidad de lectura (duración de fonemas ajustada por rate)
      const vowelDuration = (0.11 / rateMultiplier);
      const consonantDuration = (0.06 / rateMultiplier);
      const pauseDuration = (0.15 / rateMultiplier);

      const words = processed.split(" ");
      const audioChunks = [];

      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const word = words[wIdx].toLowerCase();
        for (let cIdx = 0; cIdx < word.length; cIdx++) {
          const char = word[cIdx];
          const isVowel = /[aeiouáéíóúü]/.test(char);
          const dur = isVowel ? vowelDuration : consonantDuration;

          // Modulación leve de prosodia según posición en la palabra
          const pitchMod = f0 * (1 + 0.05 * Math.sin((cIdx / Math.max(1, word.length)) * Math.PI));
          const chunk = this.synthesizePhoneme(char, pitchMod, dur, this.sampleRate, isVowel);
          audioChunks.push(chunk);
        }

        // Breve pausa inter-palabra
        const pauseSamples = Math.floor(pauseDuration * this.sampleRate);
        audioChunks.push(new Float32Array(pauseSamples));
      }

      // Concatenar todos los chunks de audio
      const totalSamples = audioChunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of audioChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      // Codificar en WAV PCM 16-bit
      const wavBuffer = this.encodeWAV(merged, this.sampleRate);
      return new Blob([wavBuffer], { type: "audio/wav" });
    }

    /**
     * Descarga el archivo generado directamente en el navegador del usuario.
     */
    downloadAudioFile(text, options = {}, filename = "audio_lector_ambystoma.wav") {
      const blob = this.generateWavFromText(text, options);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
      return blob;
    }
  }

  window.AudioExporter = AudioExporter;
})();

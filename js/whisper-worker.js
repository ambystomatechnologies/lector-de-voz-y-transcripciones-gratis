/**
 * Web Worker para Transcripción de Archivos de Audio en el Navegador (100% Cliente / GitHub Pages)
 * Utiliza Whisper IA (@xenova/transformers en WebAssembly) + Diarización Acústica MFCC.
 */

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

// Configurar entorno de Transformers.js para navegador estático (GitHub Pages)
env.allowLocalModels = false;
env.useBrowserCache = true;

let whisperPipeline = null;
let loadedModelId = null;

/**
 * Formatea segundos en MM:SS o HH:MM:SS
 */
function formatSeconds(seconds) {
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
 * Diarizador Acústico en JavaScript (MFCC + Frecuencia Fundamental + Clustering Jerárquico)
 * Equivalente 100% cliente al OfflineAudioDiarizer de server.py
 */
class ClientAudioDiarizer {
  static extractFeatures(signal, sr = 16000) {
    const frameLen = 256;
    const frameStep = 160;
    const numMel = 16;
    const numCep = 12;

    // Submuestrear tramas si el segmento es muy largo para mantener velocidad instantánea
    const maxSamples = Math.min(signal.length, sr * 12);
    const totalFrames = Math.max(1, Math.floor((maxSamples - frameLen) / frameStep));
    const stepStride = Math.max(1, Math.floor(totalFrames / 60));

    // Precalcular ventana Hamming
    const hamming = new Float32Array(frameLen);
    for (let i = 0; i < frameLen; i++) {
      hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameLen - 1));
    }

    const halfFft = frameLen / 2;
    const mfccAccum = new Float64Array(numCep);
    let centroidAccum = 0;
    let pitchAccum = 0;
    let pitchCount = 0;
    let validFrames = 0;

    // Límites de búsqueda de F0 (80 Hz a 320 Hz)
    const minLag = Math.floor(sr / 320);
    const maxLag = Math.min(frameLen - 1, Math.floor(sr / 80));

    for (let f = 0; f < totalFrames; f += stepStride) {
      const offset = f * frameStep;
      let energy = 0;
      const frame = new Float32Array(frameLen);
      for (let i = 0; i < frameLen; i++) {
        const s = signal[offset + i] || 0;
        energy += s * s;
        frame[i] = s * hamming[i];
      }
      const rms = Math.sqrt(energy / frameLen);
      if (rms < 0.005) continue; // Ignorar tramas de silencio

      // Estimación de pitch (autocorrelación)
      let bestCorr = 0;
      let bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < frameLen - lag; i++) {
          corr += frame[i] * frame[i + lag];
        }
        if (corr > bestCorr) {
          bestCorr = corr;
          bestLag = lag;
        }
      }
      if (bestLag > 0 && bestCorr > 0.15 * energy) {
        pitchAccum += sr / bestLag;
        pitchCount++;
      }

      // Espectro de potencia por bandas Mel aproximadas
      const melEnergies = new Float64Array(numMel);
      let weightedFreq = 0;
      let totalMag = 0;

      // Evaluar 32 frecuencias representativas distribuidas en escala Mel
      for (let m = 0; m < numMel; m++) {
        const melLow = 2595 * Math.log10(1 + 80 / 700);
        const melHigh = 2595 * Math.log10(1 + (sr / 2) / 700);
        const melCenter = melLow + ((m + 0.5) / numMel) * (melHigh - melLow);
        const freqHz = 700 * (Math.pow(10, melCenter / 2595) - 1);
        const omega = (2 * Math.PI * freqHz) / sr;

        // Goertzel / DFT puntual en la frecuencia central Mel
        let re = 0;
        let im = 0;
        for (let n = 0; n < frameLen; n += 2) {
          const angle = omega * n;
          re += frame[n] * Math.cos(angle);
          im -= frame[n] * Math.sin(angle);
        }
        const mag = Math.sqrt(re * re + im * im) + 1e-8;
        melEnergies[m] = Math.log(mag);
        weightedFreq += freqHz * mag;
        totalMag += mag;
      }

      if (totalMag > 0) {
        centroidAccum += weightedFreq / totalMag;
      }

      // DCT Tipo II para obtener MFCCs
      for (let k = 0; k < numCep; k++) {
        let sum = 0;
        for (let m = 0; m < numMel; m++) {
          sum += melEnergies[m] * Math.cos((Math.PI * k * (m + 0.5)) / numMel);
        }
        mfccAccum[k] += sum;
      }

      validFrames++;
    }

    const feat = new Float64Array(numCep + 2);
    if (validFrames > 0) {
      for (let k = 0; k < numCep; k++) {
        feat[k] = mfccAccum[k] / validFrames;
      }
      feat[numCep] = centroidAccum / validFrames;
    }
    feat[numCep + 1] = pitchCount > 0 ? pitchAccum / pitchCount : 150;
    return feat;
  }

  static processDiarization(audioData, segments, sr = 16000) {
    if (!segments || segments.length === 0) return [];
    if (segments.length === 1) {
      segments[0].speaker = "Hablante 1";
      return segments;
    }

    const features = [];
    const validIndices = [];

    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx];
      const startSample = Math.max(0, Math.floor((seg.start || 0) * sr));
      const endSample = Math.min(audioData.length, Math.floor((seg.end || 0) * sr));
      if (endSample - startSample < Math.floor(0.15 * sr)) continue;

      const subAudio = audioData.subarray(startSample, endSample);
      const feat = this.extractFeatures(subAudio, sr);
      features.push(feat);
      validIndices.push(idx);
    }

    if (features.length < 2) {
      segments.forEach((s) => { s.speaker = "Hablante 1"; });
      return segments;
    }

    // Estandarización Z-score por dimensión
    const dim = features[0].length;
    const mean = new Float64Array(dim);
    const std = new Float64Array(dim);

    for (const f of features) {
      for (let d = 0; d < dim; d++) mean[d] += f[d];
    }
    for (let d = 0; d < dim; d++) mean[d] /= features.length;

    for (const f of features) {
      for (let d = 0; d < dim; d++) {
        const diff = f[d] - mean[d];
        std[d] += diff * diff;
      }
    }
    for (let d = 0; d < dim; d++) {
      std[d] = Math.sqrt(std[d] / features.length) || 1.0;
    }

    const scaled = features.map((f) => {
      const s = new Float64Array(dim);
      for (let d = 0; d < dim; d++) {
        // Dar mayor peso al pitch (F0) y primeros MFCCs para distinguir timbres vocales
        const weight = d === dim - 1 ? 1.8 : 1.0;
        s[d] = ((f[d] - mean[d]) / std[d]) * weight;
      }
      return s;
    });

    // Encontrar los dos segmentos más distantes como centroides iniciales (K-Means++ determinista)
    let maxDist = -1;
    let seedA = 0;
    let seedB = 1;
    for (let i = 0; i < scaled.length; i++) {
      for (let j = i + 1; j < scaled.length; j++) {
        let dist = 0;
        for (let d = 0; d < dim; d++) {
          const diff = scaled[i][d] - scaled[j][d];
          dist += diff * diff;
        }
        if (dist > maxDist) {
          maxDist = dist;
          seedA = i;
          seedB = j;
        }
      }
    }

    // Si la distancia acústica máxima es muy baja, es un único hablante constante
    if (maxDist < 4.5) {
      segments.forEach((s) => { s.speaker = "Hablante 1"; });
      return segments;
    }

    let centroid0 = Float64Array.from(scaled[seedA]);
    let centroid1 = Float64Array.from(scaled[seedB]);
    const labels = new Int32Array(scaled.length);

    for (let iter = 0; iter < 12; iter++) {
      const sum0 = new Float64Array(dim);
      const sum1 = new Float64Array(dim);
      let count0 = 0;
      let count1 = 0;

      for (let i = 0; i < scaled.length; i++) {
        let d0 = 0;
        let d1 = 0;
        for (let d = 0; d < dim; d++) {
          const diff0 = scaled[i][d] - centroid0[d];
          const diff1 = scaled[i][d] - centroid1[d];
          d0 += diff0 * diff0;
          d1 += diff1 * diff1;
        }
        if (d0 <= d1) {
          labels[i] = 0;
          count0++;
          for (let d = 0; d < dim; d++) sum0[d] += scaled[i][d];
        } else {
          labels[i] = 1;
          count1++;
          for (let d = 0; d < dim; d++) sum1[d] += scaled[i][d];
        }
      }

      if (count0 > 0) {
        for (let d = 0; d < dim; d++) centroid0[d] = sum0[d] / count0;
      }
      if (count1 > 0) {
        for (let d = 0; d < dim; d++) centroid1[d] = sum1[d] / count1;
      }
    }

    // Asegurar que el primer hablante cronológico sea siempre "Hablante 1"
    const firstLabel = labels[0];
    for (let i = 0; i < validIndices.length; i++) {
      const segIdx = validIndices[i];
      const spkNum = labels[i] === firstLabel ? 1 : 2;
      segments[segIdx].speaker = `Hablante ${spkNum}`;
    }

    let currentSpk = "Hablante 1";
    for (const seg of segments) {
      if (!seg.speaker) {
        seg.speaker = currentSpk;
      } else {
        currentSpk = seg.speaker;
      }
    }

    return segments;
  }
}

/**
 * Formatea los segmentos transcritos según las opciones de hablantes y marcas de tiempo
 */
function formatSegmentsToText(segments, diarize, timestamps) {
  if (!segments || segments.length === 0) return "";

  if (!diarize) {
    return segments
      .map((seg) => {
        const tsStr = timestamps ? `[${formatSeconds(seg.start)}] ` : "";
        return `${tsStr}${seg.text}`;
      })
      .join("\n\n");
  }

  // Agrupar intervenciones consecutivas del mismo hablante (idéntico a server.py)
  const blocks = [];
  let currentSpeaker = null;
  let currentTexts = [];
  let currentStartTime = 0;

  for (const seg of segments) {
    const spk = seg.speaker || "Hablante 1";
    const tStart = seg.start || 0;
    if (spk !== currentSpeaker) {
      if (currentSpeaker !== null && currentTexts.length > 0) {
        const tsStr = timestamps ? `[${formatSeconds(currentStartTime)}] ` : "";
        blocks.push(`${tsStr}${currentSpeaker}: ${currentTexts.join(" ")}`);
        currentTexts = [];
      }
      currentSpeaker = spk;
      currentStartTime = tStart;
    }
    currentTexts.push(seg.text);
  }

  if (currentSpeaker !== null && currentTexts.length > 0) {
    const tsStr = timestamps ? `[${formatSeconds(currentStartTime)}] ` : "";
    blocks.push(`${tsStr}${currentSpeaker}: ${currentTexts.join(" ")}`);
  }

  return blocks.join("\n\n");
}

/**
 * Divide el audio en bloques de ~22-26 segundos buscando pausas naturales (silencios)
 * para no cortar palabras a la mitad y ofrecer progreso en tiempo real.
 */
function splitAudioIntoSmartChunks(audioData, sr = 16000) {
  const totalSamples = audioData.length;
  const minChunkSamples = 15 * sr;
  const targetChunkSamples = 23 * sr;
  const maxChunkSamples = 27 * sr;
  const windowSamples = Math.floor(0.2 * sr); // Ventana de 200ms para medir silencio

  const chunks = [];
  let startSample = 0;

  while (startSample < totalSamples) {
    const remaining = totalSamples - startSample;
    if (remaining <= maxChunkSamples) {
      chunks.push({ startSample, endSample: totalSamples });
      break;
    }

    // Buscar el punto de menor energía entre 15s y 27s desde startSample
    const searchStart = startSample + minChunkSamples;
    const searchEnd = Math.min(totalSamples - windowSamples, startSample + maxChunkSamples);
    let bestCut = startSample + targetChunkSamples;
    let minEnergy = Infinity;

    for (let pos = searchStart; pos <= searchEnd; pos += Math.floor(windowSamples / 2)) {
      let sumSq = 0;
      for (let i = 0; i < windowSamples; i++) {
        const v = audioData[pos + i] || 0;
        sumSq += v * v;
      }
      if (sumSq < minEnergy) {
        minEnergy = sumSq;
        bestCut = pos + Math.floor(windowSamples / 2);
      }
    }

    chunks.push({ startSample, endSample: bestCut });
    startSample = bestCut;
  }

  return chunks;
}

/**
 * Inicializa o recupera el pipeline de Whisper IA
 */
async function getWhisperPipeline(jobId) {
  if (whisperPipeline) return whisperPipeline;

  const modelsToTry = ["Xenova/whisper-base", "Xenova/whisper-tiny"];
  let lastErr = null;

  for (const modelId of modelsToTry) {
    try {
      self.postMessage({
        id: jobId,
        type: "status",
        progress: 2,
        message: "Inicializando motor Whisper IA en tu navegador...",
        current_time: "00:00",
        total_time: "--:--"
      });

      whisperPipeline = await pipeline("automatic-speech-recognition", modelId, {
        quantized: true,
        progress_callback: (info) => {
          if (info && info.status === "progress" && typeof info.progress === "number") {
            const pct = Math.min(15, Math.max(2, Math.round(info.progress * 0.15)));
            self.postMessage({
              id: jobId,
              type: "status",
              progress: pct,
              message: `Cargando modelo Whisper IA en caché del navegador (${Math.round(info.progress)}%)...`,
              current_time: "00:00",
              total_time: "--:--"
            });
          }
        }
      });

      loadedModelId = modelId;
      return whisperPipeline;
    } catch (err) {
      lastErr = err;
      whisperPipeline = null;
    }
  }

  throw lastErr || new Error("No se pudo inicializar el modelo Whisper IA en el navegador.");
}

self.onmessage = async (event) => {
  const { id, audioData, sampleRate = 16000, language = "es-CR", diarize = true, timestamps = true } = event.data || {};
  if (!audioData) return;

  try {
    const transcriber = await getWhisperPipeline(id);

    const totalDuration = Math.max(0.1, audioData.length / sampleRate);
    const totalTimeStr = formatSeconds(totalDuration);

    const langPrefix = (language || "es").split("-")[0].toLowerCase();
    const whisperLang = langPrefix === "en" ? "english" : "spanish";

    self.postMessage({
      id,
      type: "status",
      progress: 5,
      message: `Iniciando transcripción con Whisper IA (Duración total: ${totalTimeStr})...`,
      current_time: "00:00",
      total_time: totalTimeStr
    });

    const chunks = splitAudioIntoSmartChunks(audioData, sampleRate);
    const segmentsRaw = [];

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const { startSample, endSample } = chunks[cIdx];
      const chunkStartSec = startSample / sampleRate;
      const chunkEndSec = endSample / sampleRate;
      const chunkSlice = audioData.subarray(startSample, endSample);

      // Comprobar si el bloque es puro silencio digital
      let sumSq = 0;
      for (let i = 0; i < chunkSlice.length; i += 4) {
        sumSq += chunkSlice[i] * chunkSlice[i];
      }
      const rms = Math.sqrt(sumSq / Math.max(1, chunkSlice.length / 4));

      if (rms >= 0.0006) {
        const result = await transcriber(chunkSlice, {
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
              text: txt
            });
          }
        } else if (result && typeof result.text === "string" && result.text.trim()) {
          segmentsRaw.push({
            start: chunkStartSec,
            end: chunkEndSec,
            text: result.text.trim()
          });
        }
      }

      // Diarización parcial en vivo si está activada
      if (diarize && segmentsRaw.length > 0) {
        ClientAudioDiarizer.processDiarization(audioData, segmentsRaw, sampleRate);
      }

      const currentFullText = formatSegmentsToText(segmentsRaw, diarize, timestamps);
      const pct = Math.min(98, Math.max(6, Math.round((chunkEndSec / totalDuration) * 100)));
      const currentTimeStr = formatSeconds(chunkEndSec);
      const wordCount = currentFullText.trim() ? currentFullText.trim().split(/\s+/).length : 0;

      self.postMessage({
        id,
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

    if (segmentsRaw.length === 0) {
      self.postMessage({
        id,
        type: "done",
        progress: 100,
        message: "No se detectó voz audible en el archivo.",
        full_text: "",
        segments: [],
        word_count: 0
      });
      return;
    }

    // Diarización acústica final consolidada
    if (diarize && segmentsRaw.length > 0) {
      self.postMessage({
        id,
        type: "status",
        progress: 99,
        message: "Aplicando diferenciación acústica de hablantes...",
        current_time: totalTimeStr,
        total_time: totalTimeStr
      });
      ClientAudioDiarizer.processDiarization(audioData, segmentsRaw, sampleRate);
    }

    const finalFullText = formatSegmentsToText(segmentsRaw, diarize, timestamps);
    const finalWords = finalFullText.trim() ? finalFullText.trim().split(/\s+/).length : 0;

    self.postMessage({
      id,
      type: "done",
      progress: 100,
      message: "¡Transcripción completada con éxito!",
      full_text: finalFullText,
      segments: segmentsRaw,
      word_count: finalWords
    });
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      error: err && err.message ? err.message : String(err)
    });
  }
};

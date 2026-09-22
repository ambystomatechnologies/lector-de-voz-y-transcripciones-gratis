/**
 * Motor de Pronunciación Fonética Personalizada
 * Réplica exacta y optimizada del algoritmo de 3 capas de la aplicación de escritorio.
 */

// Conjunto de caracteres alfanuméricos españoles para límites de palabra personalizados
const WORD_CHARS_ES = "0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ_";

// Diccionario predeterminado: solo un ejemplo como regla inicial
const DEFAULT_RULES = [
  ["apple", "apel"]
];

class PronunciationManager {
  constructor() {
    this.storageKey = "lector_voz_pronunciation_rules_v3";
    this.rules = this.loadRules();
  }

  /**
   * Carga reglas desde localStorage o devuelve las predeterminadas.
   */
  loadRules() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("No se pudieron cargar reglas guardadas, usando por defecto:", e);
    }
    return [...DEFAULT_RULES];
  }

  /**
   * Guarda las reglas en localStorage.
   */
  saveRules() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.rules));
    } catch (e) {
      console.error("Error guardando reglas en localStorage:", e);
    }
  }

  /**
   * Restaura el diccionario predeterminado.
   */
  restoreDefaultRules() {
    this.rules = [...DEFAULT_RULES];
    this.saveRules();
    return this.rules;
  }

  /**
   * Agrega o actualiza una regla de pronunciación.
   */
  addRule(written, spoken) {
    const w = (written || "").trim();
    const s = (spoken || "").trim();
    if (!w || !s) return false;

    const normW = w.normalize("NFC").toLowerCase();
    const existingIndex = this.rules.findIndex(
      ([orig]) => orig.trim().normalize("NFC").toLowerCase() === normW
    );

    if (existingIndex >= 0) {
      this.rules[existingIndex] = [w, s];
    } else {
      this.rules.push([w, s]);
    }
    this.saveRules();
    return true;
  }

  /**
   * Elimina una regla por índice.
   */
  removeRule(index) {
    if (index >= 0 && index < this.rules.length) {
      this.rules.splice(index, 1);
      this.saveRules();
      return true;
    }
    return false;
  }

  /**
   * Limpia todas las reglas.
   */
  clearRules() {
    this.rules = [];
    this.saveRules();
  }

  /**
   * Normaliza texto eliminando caracteres invisibles y saltos excesivos
   * (idéntico a normalize_text de la aplicación Python).
   */
  normalizeText(text) {
    if (!text) return "";
    let str = text;
    // Eliminar caracteres invisibles comunes en EPUB y UTF-8 (guiones suaves, zero-width, BOM, etc.)
    str = str.replace(/[\u00ad\u200b\u200c\u200d\ufeff\u2060\u2028\u2029]/g, "");
    // Reemplazar guiones (ej. "audio-textos" -> "audio textos") por espacios para que el sintetizador no los deletree
    str = str.replace(/[-—–_]/g, " ");
    str = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    str = str.replace(/[\t\v\f]+/g, " ");
    str = str.replace(/ *\n */g, "\n");
    str = str.replace(/\n{3,}/g, "\n\n");
    str = str.replace(/ {2,}/g, " ");
    return str.trim();
  }

  /**
   * Escapa caracteres especiales para usar en RegExp.
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Aplica las reglas de pronunciación en 3 capas de prioridad
   * (Idéntico a apply_pronunciation_rules en Python).
   */
  applyRules(text) {
    if (!text || !this.rules || this.rules.length === 0) {
      return text || "";
    }

    let fixedText = this.normalizeText(text).normalize("NFC");

    // Limpiar reglas y ordenar por longitud decreciente
    const cleanRules = [];
    for (const [w, s] of this.rules) {
      const written = (w || "").trim().normalize("NFC");
      const spoken = (s || "").trim();
      if (written && spoken && written !== spoken) {
        cleanRules.push([written, spoken]);
      }
    }
    cleanRules.sort((a, b) => b[0].length - a[0].length);

    for (const [written, spoken] of cleanRules) {
      const escaped = this.escapeRegExp(written);

      // --- Capa 1: límites españoles personalizados ---
      try {
        const pattern1 = new RegExp(`(?<![${WORD_CHARS_ES}])${escaped}(?![${WORD_CHARS_ES}])`, "gi");
        if (pattern1.test(fixedText)) {
          fixedText = fixedText.replace(pattern1, spoken);
          continue;
        }
      } catch (e) {
        // Fallback si algún entorno no soporta lookbehind
      }

      // --- Capa 2: \b límite de palabra estándar ---
      try {
        const pattern2 = new RegExp(`\\b${escaped}\\b`, "gi");
        if (pattern2.test(fixedText)) {
          fixedText = fixedText.replace(pattern2, spoken);
          continue;
        }
      } catch (e) {}

      // --- Capa 3: reemplazo literal sin límites ---
      try {
        const pattern3 = new RegExp(escaped, "gi");
        fixedText = fixedText.replace(pattern3, spoken);
      } catch (e) {}
    }

    return fixedText;
  }

  /**
   * Importa reglas desde un archivo Excel (.xlsx o .xls) usando SheetJS.
   */
  async importFromExcel(file) {
    if (typeof XLSX === "undefined") {
      throw new Error("Librería SheetJS (XLSX) no disponible.");
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          if (!rows || rows.length === 0) {
            resolve({ imported: 0, skipped: 0, total: 0 });
            return;
          }

          const headerHints = new Set([
            "texto", "escrito", "libro", "nombre", "palabra", "termino",
            "fonética", "fonetica", "sonar", "pronuncia", "pronunciacion", "pronunciación", "spoken", "written"
          ]);

          let startIndex = 0;
          const first = rows[0];
          if (
            first &&
            first.length >= 2 &&
            typeof first[0] === "string" &&
            typeof first[1] === "string"
          ) {
            const h0 = first[0].trim().toLowerCase();
            const h1 = first[1].trim().toLowerCase();
            if (headerHints.has(h0) || headerHints.has(h1)) {
              startIndex = 1;
            }
          }

          const existingWritten = new Set(
            this.rules.map(([w]) => (w || "").trim().normalize("NFC").toLowerCase())
          );

          let imported = 0;
          let skipped = 0;

          for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) continue;
            const written = row[0] != null ? String(row[0]).trim() : "";
            const spoken = row[1] != null ? String(row[1]).trim() : "";
            if (!written || !spoken) continue;

            const key = written.normalize("NFC").toLowerCase();
            if (existingWritten.has(key)) {
              skipped++;
              continue;
            }

            this.rules.push([written, spoken]);
            existingWritten.add(key);
            imported++;
          }

          this.saveRules();
          resolve({ imported, skipped, total: this.rules.length });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Exporta el diccionario actual a un archivo Excel (.xlsx).
   */
  exportToExcel() {
    if (typeof XLSX === "undefined") {
      throw new Error("Librería SheetJS no disponible.");
    }

    const wsData = [
      ["Texto en el libro", "Cómo debe sonar (Fonética)"],
      ...this.rules
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Diccionario Pronunciación");
    XLSX.writeFile(wb, "diccionario_pronunciacion.xlsx");
  }

  /**
   * Exporta el diccionario actual como JSON.
   */
  exportToJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.rules, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "diccionario_pronunciacion.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }
}

// Instancia global disponible para la aplicación
window.pronunciationManager = new PronunciationManager();

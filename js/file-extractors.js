/**
 * Extractores de Archivos en el Navegador
 * Soporta TXT, MD, CSV, SRT, VTT, HTML, PDF, DOCX, EPUB y RTF en el cliente.
 */

class FileExtractor {
  /**
   * Lee un archivo de texto con codificación flexible (UTF-8, ISO-8859-1).
   */
  static readAsText(file, encoding = "utf-8") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (err) => reject(err);
      reader.readAsText(file, encoding);
    });
  }

  /**
   * Lee un archivo como ArrayBuffer.
   */
  static readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Extrae texto de HTML removiendo scripts, estilos y etiquetas invisibles.
   */
  static async extractHtml(file) {
    const raw = await this.readAsText(file);
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "text/html");

    // Eliminar etiquetas que no forman parte del contenido legible
    doc.querySelectorAll("script, style, noscript, svg, nav, footer, header").forEach((el) => el.remove());

    const bodyText = doc.body ? doc.body.innerText || doc.body.textContent : doc.documentElement.textContent;
    return bodyText || "";
  }

  /**
   * Extrae texto de documentos PDF usando PDF.js.
   */
  static async extractPdf(file, onProgress) {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("Librería PDF.js no disponible para leer archivos PDF.");
    }

    const arrayBuffer = await this.readAsArrayBuffer(file);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;

    const numPages = pdfDoc.numPages;
    const pagesText = [];

    for (let i = 1; i <= numPages; i++) {
      if (onProgress) {
        onProgress({ current: i, total: numPages, percent: Math.round((i / numPages) * 100) });
      }
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageStrings = textContent.items.map((item) => item.str);
      const pageText = pageStrings.join(" ").trim();
      if (pageText) {
        pagesText.push(`\n\n--- Página ${i} ---\n` + pageText);
      }
    }

    if (pagesText.length === 0) {
      throw new Error("No se pudo extraer texto del PDF. Si es un documento escaneado, requiere OCR previo.");
    }

    return pagesText.join("");
  }

  /**
   * Extrae texto de documentos DOCX usando Mammoth.js.
   */
  static async extractDocx(file) {
    if (typeof mammoth === "undefined") {
      throw new Error("Librería Mammoth no disponible para leer archivos DOCX.");
    }

    const arrayBuffer = await this.readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer });
    if (!result.value || !result.value.trim()) {
      throw new Error("El archivo DOCX no contiene texto legible.");
    }
    return result.value;
  }

  /**
   * Extrae texto de libros EPUB usando JSZip y DOMParser.
   */
  static async extractEpub(file, onProgress) {
    if (typeof JSZip === "undefined") {
      throw new Error("Librería JSZip no disponible para descomprimir libros EPUB.");
    }

    const arrayBuffer = await this.readAsArrayBuffer(file);
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Buscar el archivo container.xml
    const containerEntry = zip.file("META-INF/container.xml");
    let opfPath = "";

    if (containerEntry) {
      const containerXml = await containerEntry.async("text");
      const parser = new DOMParser();
      const doc = parser.parseFromString(containerXml, "application/xml");
      const rootfile = doc.querySelector("rootfile");
      if (rootfile && rootfile.getAttribute("full-path")) {
        opfPath = rootfile.getAttribute("full-path");
      }
    }

    const parser = new DOMParser();
    const chapterTexts = [];

    // Si encontramos el archivo OPF, leemos los elementos del spine en orden
    if (opfPath && zip.file(opfPath)) {
      const opfXml = await zip.file(opfPath).async("text");
      const opfDoc = parser.parseFromString(opfXml, "application/xml");
      const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

      // Mapear manifest id -> href
      const manifest = {};
      opfDoc.querySelectorAll("manifest > item").forEach((item) => {
        const id = item.getAttribute("id");
        const href = item.getAttribute("href");
        if (id && href) manifest[id] = href;
      });

      // Orden del spine
      const spineItems = Array.from(opfDoc.querySelectorAll("spine > itemref"))
        .map((ref) => ref.getAttribute("idref"))
        .filter(Boolean);

      const totalChapters = spineItems.length;
      for (let idx = 0; idx < spineItems.length; idx++) {
        const idref = spineItems[idx];
        const href = manifest[idref];
        if (href) {
          const fullPath = opfDir + href;
          const chapterFile = zip.file(fullPath) || zip.file(decodeURIComponent(fullPath));
          if (chapterFile) {
            try {
              const htmlContent = await chapterFile.async("text");
              const docHtml = parser.parseFromString(htmlContent, "text/html");
              docHtml.querySelectorAll("script, style").forEach((el) => el.remove());
              const text = docHtml.body ? docHtml.body.innerText || docHtml.body.textContent : docHtml.documentElement.textContent;
              if (text && text.trim()) {
                chapterTexts.push(text.trim());
              }
            } catch (e) {
              console.warn("Error leyendo capítulo EPUB:", fullPath, e);
            }
          }
        }
        if (onProgress) {
          onProgress({ current: idx + 1, total: totalChapters, percent: Math.round(((idx + 1) / totalChapters) * 100) });
        }
      }
    }

    // Fallback: Si no se pudo leer el spine, buscar todos los archivos .xhtml/.html en el zip
    if (chapterTexts.length === 0) {
      const htmlFiles = Object.keys(zip.files).filter(
        (fname) => fname.match(/\.(x?html?|xml)$/i) && !fname.includes("META-INF") && !fname.endsWith(".opf") && !fname.endsWith(".ncx")
      );
      htmlFiles.sort();

      for (let i = 0; i < htmlFiles.length; i++) {
        const fname = htmlFiles[i];
        const content = await zip.files[fname].async("text");
        const docHtml = parser.parseFromString(content, "text/html");
        docHtml.querySelectorAll("script, style").forEach((el) => el.remove());
        const text = docHtml.body ? docHtml.body.innerText || docHtml.body.textContent : docHtml.documentElement.textContent;
        if (text && text.trim()) {
          chapterTexts.push(text.trim());
        }
      }
    }

    if (chapterTexts.length === 0) {
      throw new Error("No se pudo extraer texto del libro EPUB.");
    }

    return chapterTexts.join("\n\n");
  }

  /**
   * Extrae texto plano de formato RTF.
   */
  static async extractRtf(file) {
    let raw = await this.readAsText(file);
    raw = raw.replace(/\\'[0-9a-fA-F]{2}/g, " ");
    raw = raw.replace(/\\[a-zA-Z]+-?\d* ?/g, " ");
    raw = raw.replace(/[{}]/g, " ").replace(/\\/g, " ");
    return raw;
  }

  /**
   * Método principal unificado para extraer texto de cualquier archivo soportado.
   */
  static async extract(file, onProgress) {
    if (!file) throw new Error("No se seleccionó ningún archivo.");

    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();

    let extractedText = "";

    switch (ext) {
      case ".txt":
      case ".md":
      case ".csv":
      case ".srt":
      case ".vtt":
      case ".log":
      case ".json":
      case ".xml":
        extractedText = await this.readAsText(file);
        break;

      case ".html":
      case ".htm":
        extractedText = await this.extractHtml(file);
        break;

      case ".pdf":
        extractedText = await this.extractPdf(file, onProgress);
        break;

      case ".docx":
        extractedText = await this.extractDocx(file);
        break;

      case ".epub":
        extractedText = await this.extractEpub(file, onProgress);
        break;

      case ".rtf":
        extractedText = await this.extractRtf(file);
        break;

      default:
        // Intentar leer como texto genérico
        try {
          extractedText = await this.readAsText(file);
        } catch (e) {
          throw new Error(`Formato de archivo no soportado: ${ext}`);
        }
    }

    if (window.pronunciationManager) {
      extractedText = window.pronunciationManager.normalizeText(extractedText);
    }

    if (!extractedText.trim()) {
      throw new Error("El archivo no contiene texto legible o está vacío.");
    }

    return extractedText;
  }
}

window.FileExtractor = FileExtractor;

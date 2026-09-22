/**
 * LectorVoz Pro - Controlador Principal de la Aplicación
 * Conecta UI, Drag & Drop, Extractores de Archivos, Diccionario Fonético y Motor TTS.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Inicializar Motores
  const pronManager = window.pronunciationManager;
  const ttsEngine = new window.TTSEngine();
  const audioExporter = new window.AudioExporter();

  // Referencias a Elementos DOM
  const fileInput = document.getElementById("fileInput");
  const dropzone = document.getElementById("dropzone");
  const fileBadge = document.getElementById("fileBadge");
  const fileNameDisplay = document.getElementById("fileNameDisplay");

  const mainTextarea = document.getElementById("mainTextarea");
  const readingViewer = document.getElementById("readingViewer");
  const tabEditor = document.getElementById("tabEditor");
  const tabReading = document.getElementById("tabReading");

  const charCount = document.getElementById("charCount");
  const wordCount = document.getElementById("wordCount");
  const readingTime = document.getElementById("readingTime");

  const btnCleanText = document.getElementById("btnCleanText");
  const btnClearText = document.getElementById("btnClearText");
  const btnSampleText = document.getElementById("btnSampleText");

  // Controles de Reproducción
  const btnBigPlay = document.getElementById("btnBigPlay");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnStop = document.getElementById("btnStop");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnDownloadAudio = document.getElementById("btnDownloadAudio");
  const downloadLoadingBox = document.getElementById("downloadLoadingBox");
  const downloadBtnIcon = document.getElementById("downloadBtnIcon");
  const downloadBtnText = document.getElementById("downloadBtnText");
  const downloadLoadingText = document.getElementById("downloadLoadingText");
  const downloadSubtext = document.getElementById("downloadSubtext");
  const ttsOutputFilename = document.getElementById("ttsOutputFilename");
  const ttsOutputFilenameExt = document.getElementById("ttsOutputFilenameExt");
  let currentLoadedDocName = "";

  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const progressPercent = document.getElementById("progressPercent");
  const statusText = document.getElementById("statusText");
  const statusDot = document.getElementById("statusDot");
  const visualizerBars = document.getElementById("visualizerBars");

  // Controles de Voz
  const localeFilter = document.getElementById("localeFilter");
  const voiceSelect = document.getElementById("voiceSelect");
  const rateSlider = document.getElementById("rateSlider");
  const rateVal = document.getElementById("rateVal");
  const pitchSlider = document.getElementById("pitchSlider");
  const pitchVal = document.getElementById("pitchVal");
  const volumeSlider = document.getElementById("volumeSlider");
  const volumeVal = document.getElementById("volumeVal");

  // Diccionario Fonético
  const dictCountBadge = document.getElementById("dictCountBadge");
  const btnOpenDict = document.getElementById("btnOpenDict");
  const btnCloseDict = document.getElementById("btnCloseDict");
  const dictModal = document.getElementById("dictModal");
  const dictTableBody = document.getElementById("dictTableBody");
  const inputWritten = document.getElementById("inputWritten");
  const inputSpoken = document.getElementById("inputSpoken");
  const btnAddRule = document.getElementById("btnAddRule");
  const dictSearch = document.getElementById("dictSearch");
  const btnImportExcel = document.getElementById("btnImportExcel");
  const excelFileInput = document.getElementById("excelFileInput");
  const btnExportExcel = document.getElementById("btnExportExcel");
  const btnExportJSON = document.getElementById("btnExportJSON");
  const btnResetDict = document.getElementById("btnResetDict");

  // Modal Acerca de / Ayuda
  const btnOpenHelp = document.getElementById("btnOpenHelp");
  const btnCloseHelp = document.getElementById("btnCloseHelp");
  const helpModal = document.getElementById("helpModal");

  // =========================================================================
  // 1. Funciones de Notificación (Toast)
  // =========================================================================
  function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer") || (() => {
      const c = document.createElement("div");
      c.id = "toastContainer";
      c.className = "toast-container";
      document.body.appendChild(c);
      return c;
    })();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
    toast.innerHTML = `<span style="font-weight:bold; color: #38bdf8;">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // 2. Estadísticas y Limpieza del Texto
  // =========================================================================
  function updateTextStats() {
    const text = mainTextarea.value || "";
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const minutes = Math.ceil(words / 150); // Estimado a 150 palabras por minuto

    charCount.textContent = `${chars.toLocaleString()} caracteres`;
    wordCount.textContent = `${words.toLocaleString()} palabras`;
    readingTime.textContent = `~ ${minutes} min de lectura`;
  }

  mainTextarea.addEventListener("input", updateTextStats);

  btnCleanText.addEventListener("click", () => {
    if (!mainTextarea.value.trim()) return;
    mainTextarea.value = pronManager.normalizeText(mainTextarea.value);
    updateTextStats();
    showToast("Texto normalizado y formateado correctamente.", "success");
  });

  btnClearText.addEventListener("click", () => {
    if (!mainTextarea.value.trim()) return;
    if (confirm("¿Deseas vaciar el texto actual?")) {
      ttsEngine.stop();
      mainTextarea.value = "";
      fileBadge.style.display = "none";
      updateTextStats();
      buildReadingViewer();
      showToast("Texto borrado.", "info");
    }
  });

  btnSampleText.addEventListener("click", () => {
    const sample = `Probando el motor de lectura a voz con corrección fonética:

La compañía apple ha presentado sus novedades tecnológicas el día de hoy.
Gracias al diccionario de pronunciación fonética personalizada, la palabra "apple" se pronuncia de forma natural como "apel" en lugar de deletrearse.`;
    mainTextarea.value = sample;
    updateTextStats();
    buildReadingViewer();
    showToast("Texto de ejemplo cargado.", "success");
  });

  // =========================================================================
  // 3. Pestañas: Editor vs Modo Lectura con Resaltado
  // =========================================================================
  function setViewMode(mode) {
    if (mode === "editor") {
      tabEditor.classList.add("active");
      tabReading.classList.remove("active");
      mainTextarea.style.display = "block";
      readingViewer.style.display = "none";
    } else {
      tabReading.classList.add("active");
      tabEditor.classList.remove("active");
      mainTextarea.style.display = "none";
      readingViewer.style.display = "block";
      buildReadingViewer();
    }
  }

  tabEditor.addEventListener("click", () => setViewMode("editor"));
  tabReading.addEventListener("click", () => setViewMode("reading"));

  function buildReadingViewer() {
    const text = mainTextarea.value || "";
    readingViewer.innerHTML = "";

    const sentences = ttsEngine.splitIntoSentences(text);
    if (sentences.length === 0) {
      readingViewer.innerHTML = `<div style="color: #64748b; text-align: center; padding: 2rem;">No hay texto para visualizar. Escribe o carga un documento.</div>`;
      return;
    }

    sentences.forEach((sentence, index) => {
      const span = document.createElement("span");
      span.className = "sentence-span";
      span.dataset.index = index;
      span.textContent = sentence + " ";
      span.addEventListener("click", () => {
        ttsEngine.loadText(mainTextarea.value);
        ttsEngine.play(index);
      });
      readingViewer.appendChild(span);
    });
  }

  function highlightReadingSentence(index) {
    const spans = readingViewer.querySelectorAll(".sentence-span");
    spans.forEach((s) => s.classList.remove("active-reading"));

    const currentSpan = readingViewer.querySelector(`.sentence-span[data-index="${index}"]`);
    if (currentSpan) {
      currentSpan.classList.add("active-reading");
      currentSpan.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // =========================================================================
  // 4. Extracción de Archivos (Drag & Drop + FilePicker)
  // =========================================================================
  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  async function handleFileSelected(file) {
    try {
      statusText.textContent = `Leyendo archivo: ${file.name}...`;
      statusDot.className = "status-dot active";

      const text = await window.FileExtractor.extract(file, (progress) => {
        statusText.textContent = `Procesando: ${progress.percent}% (${progress.current}/${progress.total})`;
      });

      mainTextarea.value = text;
      updateTextStats();

      fileNameDisplay.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
      fileBadge.style.display = "flex";

      // Asignar el nombre base del documento cargado como nombre predeterminado del audio
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      currentLoadedDocName = baseName;
      if (ttsOutputFilename && baseName) {
        ttsOutputFilename.value = baseName;
      }

      statusText.textContent = "Archivo cargado correctamente.";
      showToast(`Archivo "${file.name}" cargado con éxito.`, "success");

      buildReadingViewer();
    } catch (err) {
      console.error("Error al extraer texto:", err);
      statusText.textContent = "Error al procesar el archivo.";
      showToast(err.message || "Error al procesar el archivo.", "error");
    } finally {
      fileInput.value = "";
    }
  }

  // =========================================================================
  // 5. Configuración de Voces en Español (Todos los 22 Acentos de la App Original)
  // =========================================================================
  const ALL_SPANISH_LOCALES = [
    { code: "es-CR", name: "Costa Rica (es-CR) 🇨🇷 [Predeterminado]" },
    { code: "es-ES", name: "España (es-ES) 🇪🇸" },
    { code: "es-MX", name: "México (es-MX) 🇲🇽" },
    { code: "es-AR", name: "Argentina (es-AR) 🇦🇷" },
    { code: "es-CO", name: "Colombia (es-CO) 🇨🇴" },
    { code: "es-CL", name: "Chile (es-CL) 🇨🇱" },
    { code: "es-BO", name: "Bolivia (es-BO) 🇧🇴" },
    { code: "es-CU", name: "Cuba (es-CU) 🇨🇺" },
    { code: "es-DO", name: "República Dominicana (es-DO) 🇩🇴" },
    { code: "es-EC", name: "Ecuador (es-EC) 🇪🇨" },
    { code: "es-SV", name: "El Salvador (es-SV) 🇸🇻" },
    { code: "es-GQ", name: "Guinea Ecuatorial (es-GQ) 🇬🇶" },
    { code: "es-GT", name: "Guatemala (es-GT) 🇬🇹" },
    { code: "es-HN", name: "Honduras (es-HN) 🇭🇳" },
    { code: "es-NI", name: "Nicaragua (es-NI) 🇳🇮" },
    { code: "es-PA", name: "Panamá (es-PA) 🇵🇦" },
    { code: "es-PY", name: "Paraguay (es-PY) 🇵🇾" },
    { code: "es-PE", name: "Perú (es-PE) 🇵🇪" },
    { code: "es-PR", name: "Puerto Rico (es-PR) 🇵🇷" },
    { code: "es-US", name: "Estados Unidos (es-US) 🇺🇸" },
    { code: "es-UY", name: "Uruguay (es-UY) 🇺🇾" },
    { code: "es-VE", name: "Venezuela (es-VE) 🇻🇪" }
  ];

  // Catálogo completo de las 45 voces neuronales de la app original
  const ORIGINAL_APP_VOICES = [
    { shortName: "es-CR-JuanNeural", name: "Microsoft Juan Online (Natural) - Spanish (Costa Rica)", gender: "Hombre", locale: "es-CR" },
    { shortName: "es-CR-MariaNeural", name: "Microsoft Maria Online (Natural) - Spanish (Costa Rica)", gender: "Mujer", locale: "es-CR" },
    { shortName: "es-ES-AlvaroNeural", name: "Microsoft Alvaro Online (Natural) - Spanish (Spain)", gender: "Hombre", locale: "es-ES" },
    { shortName: "es-ES-ElviraNeural", name: "Microsoft Elvira Online (Natural) - Spanish (Spain)", gender: "Mujer", locale: "es-ES" },
    { shortName: "es-MX-DaliaNeural", name: "Microsoft Dalia Online (Natural) - Spanish (Mexico)", gender: "Mujer", locale: "es-MX" },
    { shortName: "es-MX-JorgeNeural", name: "Microsoft Jorge Online (Natural) - Spanish (Mexico)", gender: "Hombre", locale: "es-MX" },
    { shortName: "es-AR-ElenaNeural", name: "Microsoft Elena Online (Natural) - Spanish (Argentina)", gender: "Mujer", locale: "es-AR" },
    { shortName: "es-AR-TomasNeural", name: "Microsoft Tomas Online (Natural) - Spanish (Argentina)", gender: "Hombre", locale: "es-AR" },
    { shortName: "es-CO-GonzaloNeural", name: "Microsoft Gonzalo Online (Natural) - Spanish (Colombia)", gender: "Hombre", locale: "es-CO" },
    { shortName: "es-CO-SalomeNeural", name: "Microsoft Salome Online (Natural) - Spanish (Colombia)", gender: "Mujer", locale: "es-CO" },
    { shortName: "es-CL-CatalinaNeural", name: "Microsoft Catalina Online (Natural) - Spanish (Chile)", gender: "Mujer", locale: "es-CL" },
    { shortName: "es-CL-LorenzoNeural", name: "Microsoft Lorenzo Online (Natural) - Spanish (Chile)", gender: "Hombre", locale: "es-CL" },
    { shortName: "es-BO-MarceloNeural", name: "Microsoft Marcelo Online (Natural) - Spanish (Bolivia)", gender: "Hombre", locale: "es-BO" },
    { shortName: "es-BO-SofiaNeural", name: "Microsoft Sofia Online (Natural) - Spanish (Bolivia)", gender: "Mujer", locale: "es-BO" },
    { shortName: "es-CU-BelkysNeural", name: "Microsoft Belkys Online (Natural) - Spanish (Cuba)", gender: "Mujer", locale: "es-CU" },
    { shortName: "es-CU-ManuelNeural", name: "Microsoft Manuel Online (Natural) - Spanish (Cuba)", gender: "Hombre", locale: "es-CU" },
    { shortName: "es-DO-EmilioNeural", name: "Microsoft Emilio Online (Natural) - Spanish (Dominican Republic)", gender: "Hombre", locale: "es-DO" },
    { shortName: "es-DO-RamonaNeural", name: "Microsoft Ramona Online (Natural) - Spanish (Dominican Republic)", gender: "Mujer", locale: "es-DO" },
    { shortName: "es-EC-AndreaNeural", name: "Microsoft Andrea Online (Natural) - Spanish (Ecuador)", gender: "Mujer", locale: "es-EC" },
    { shortName: "es-EC-LuisNeural", name: "Microsoft Luis Online (Natural) - Spanish (Ecuador)", gender: "Hombre", locale: "es-EC" },
    { shortName: "es-SV-LorenaNeural", name: "Microsoft Lorena Online (Natural) - Spanish (El Salvador)", gender: "Mujer", locale: "es-SV" },
    { shortName: "es-SV-RodrigoNeural", name: "Microsoft Rodrigo Online (Natural) - Spanish (El Salvador)", gender: "Hombre", locale: "es-SV" },
    { shortName: "es-GQ-JavierNeural", name: "Microsoft Javier Online (Natural) - Spanish (Equatorial Guinea)", gender: "Hombre", locale: "es-GQ" },
    { shortName: "es-GQ-TeresaNeural", name: "Microsoft Teresa Online (Natural) - Spanish (Equatorial Guinea)", gender: "Mujer", locale: "es-GQ" },
    { shortName: "es-GT-AndresNeural", name: "Microsoft Andres Online (Natural) - Spanish (Guatemala)", gender: "Hombre", locale: "es-GT" },
    { shortName: "es-GT-MartaNeural", name: "Microsoft Marta Online (Natural) - Spanish (Guatemala)", gender: "Mujer", locale: "es-GT" },
    { shortName: "es-HN-CarlosNeural", name: "Microsoft Carlos Online (Natural) - Spanish (Honduras)", gender: "Hombre", locale: "es-HN" },
    { shortName: "es-HN-KarlaNeural", name: "Microsoft Karla Online (Natural) - Spanish (Honduras)", gender: "Mujer", locale: "es-HN" },
    { shortName: "es-NI-FedericoNeural", name: "Microsoft Federico Online (Natural) - Spanish (Nicaragua)", gender: "Hombre", locale: "es-NI" },
    { shortName: "es-NI-YolandaNeural", name: "Microsoft Yolanda Online (Natural) - Spanish (Nicaragua)", gender: "Mujer", locale: "es-NI" },
    { shortName: "es-PA-MargaritaNeural", name: "Microsoft Margarita Online (Natural) - Spanish (Panama)", gender: "Mujer", locale: "es-PA" },
    { shortName: "es-PA-RobertoNeural", name: "Microsoft Roberto Online (Natural) - Spanish (Panama)", gender: "Hombre", locale: "es-PA" },
    { shortName: "es-PY-MarioNeural", name: "Microsoft Mario Online (Natural) - Spanish (Paraguay)", gender: "Hombre", locale: "es-PY" },
    { shortName: "es-PY-TaniaNeural", name: "Microsoft Tania Online (Natural) - Spanish (Paraguay)", gender: "Mujer", locale: "es-PY" },
    { shortName: "es-PE-AlexNeural", name: "Microsoft Alex Online (Natural) - Spanish (Peru)", gender: "Hombre", locale: "es-PE" },
    { shortName: "es-PE-CamilaNeural", name: "Microsoft Camila Online (Natural) - Spanish (Peru)", gender: "Mujer", locale: "es-PE" },
    { shortName: "es-PR-KarinaNeural", name: "Microsoft Karina Online (Natural) - Spanish (Puerto Rico)", gender: "Mujer", locale: "es-PR" },
    { shortName: "es-PR-VictorNeural", name: "Microsoft Victor Online (Natural) - Spanish (Puerto Rico)", gender: "Hombre", locale: "es-PR" },
    { shortName: "es-US-AlonsoNeural", name: "Microsoft Alonso Online (Natural) - Spanish (United States)", gender: "Hombre", locale: "es-US" },
    { shortName: "es-US-PalomaNeural", name: "Microsoft Paloma Online (Natural) - Spanish (United States)", gender: "Mujer", locale: "es-US" },
    { shortName: "es-UY-MateoNeural", name: "Microsoft Mateo Online (Natural) - Spanish (Uruguay)", gender: "Hombre", locale: "es-UY" },
    { shortName: "es-UY-ValentinaNeural", name: "Microsoft Valentina Online (Natural) - Spanish (Uruguay)", gender: "Mujer", locale: "es-UY" },
    { shortName: "es-VE-PaolaNeural", name: "Microsoft Paola Online (Natural) - Spanish (Venezuela)", gender: "Mujer", locale: "es-VE" },
    { shortName: "es-VE-SebastianNeural", name: "Microsoft Sebastian Online (Natural) - Spanish (Venezuela)", gender: "Hombre", locale: "es-VE" }
  ];

  const voiceModeBadge = document.getElementById("voiceModeBadge");
  const voiceModeDot = document.getElementById("voiceModeDot");
  const voiceModeText = document.getElementById("voiceModeText");

  function getGenderFromVoiceName(name) {
    const maleKeywords = [
      "alvaro", "jorge", "juan", "gonzalo", "tomas", "lorenzo", "marcelo", "manuel",
      "emilio", "luis", "rodrigo", "javier", "andres", "carlos", "federico", "roberto",
      "mario", "alex", "victor", "alonso", "mateo", "sebastian", "david", "pablo", "raul",
      "male", "hombre", "diego", "miguel", "antonio", "francisco", "pedro"
    ];
    const femaleKeywords = [
      "dalia", "elvira", "elena", "maria", "salome", "catalina", "sofia", "belkys",
      "ramona", "andrea", "lorena", "teresa", "marta", "karla", "yolanda", "margarita",
      "tania", "camila", "karina", "paloma", "valentina", "paola", "monica", "paulina",
      "lucia", "carmen", "laura", "helena", "sabina", "female", "mujer"
    ];
    const lower = (name || "").toLowerCase();
    if (maleKeywords.some(kw => lower.includes(kw))) return "Hombre";
    if (femaleKeywords.some(kw => lower.includes(kw))) return "Mujer";
    return "Mujer";
  }

  function updateVoiceUI() {
    const hasNeuralServer = ttsEngine.useNeuralServer;
    const allSpVoices = ttsEngine.getSpanishVoices();
    const prevLocale = localeFilter.value;

    // 1. Indicador visual del modo activo (Servidor Local vs Modo Web)
    if (voiceModeBadge && voiceModeDot && voiceModeText) {
      if (hasNeuralServer) {
        voiceModeBadge.style.background = "rgba(34, 197, 94, 0.1)";
        voiceModeBadge.style.borderColor = "rgba(34, 197, 94, 0.3)";
        voiceModeBadge.style.color = "#4ade80";
        voiceModeDot.style.background = "#22c55e";
        voiceModeText.innerHTML = `<strong>Servidor Local Activo</strong> · 45 Voces Neurales de Alta Calidad`;
      } else {
        voiceModeBadge.style.background = "rgba(56, 189, 248, 0.08)";
        voiceModeBadge.style.borderColor = "rgba(56, 189, 248, 0.2)";
        voiceModeBadge.style.color = "#94a3b8";
        voiceModeDot.style.background = "#38bdf8";
        voiceModeText.innerHTML = `<strong>Modo Web</strong> · Usando voces disponibles en tu navegador`;
      }
    }

    // 2. Poblar el filtro de países / acentos (localeFilter)
    localeFilter.innerHTML = `<option value="ALL">Todos los acentos</option>`;

    if (hasNeuralServer) {
      // Servidor local activo: mostrar catálogo completo de los 22 acentos
      ALL_SPANISH_LOCALES.forEach((loc) => {
        const opt = document.createElement("option");
        opt.value = loc.code;
        opt.textContent = loc.name;
        localeFilter.appendChild(opt);
      });
      if (prevLocale && (prevLocale === "ALL" || ALL_SPANISH_LOCALES.some(l => l.code === prevLocale))) {
        localeFilter.value = prevLocale;
      } else {
        localeFilter.value = "es-CR";
      }
    } else {
      // Modo Web sin servidor: mostrar ÚNICAMENTE los países que realmente tienen voces instaladas en el navegador
      const detectedLocales = new Set();
      allSpVoices.forEach((v) => {
        const lang = (v.lang || "").toLowerCase();
        const match = ALL_SPANISH_LOCALES.find(l => lang.startsWith(l.code.toLowerCase()));
        if (match) {
          detectedLocales.add(match.code);
        } else if (lang.startsWith("es-")) {
          detectedLocales.add(lang.substring(0, 5));
        } else if (lang.startsWith("es")) {
          detectedLocales.add("es-ES");
        }
      });

      if (detectedLocales.size > 0) {
        ALL_SPANISH_LOCALES.forEach((loc) => {
          if (detectedLocales.has(loc.code)) {
            const opt = document.createElement("option");
            opt.value = loc.code;
            opt.textContent = loc.name;
            localeFilter.appendChild(opt);
          }
        });
      }

      if (prevLocale && (prevLocale === "ALL" || detectedLocales.has(prevLocale))) {
        localeFilter.value = prevLocale;
      } else if (detectedLocales.size > 0) {
        localeFilter.value = Array.from(detectedLocales)[0];
      } else {
        localeFilter.value = "ALL";
      }
    }

    renderFilteredVoices();
  }

  function renderFilteredVoices() {
    const selectedLocale = localeFilter.value;
    const allSpVoices = ttsEngine.getSpanishVoices();
    const hasNeuralServer = ttsEngine.useNeuralServer;
    const prevVoiceValue = voiceSelect.value;
    voiceSelect.innerHTML = "";

    // 1. CATÁLOGO DE VOCES NEURALES (edge-tts / servidor Python)
    // Se muestra ÚNICAMENTE si el servidor local de edge-tts está corriendo.
    // En la página web publicada NO aparecerán porque no hay servidor Python.
    if (hasNeuralServer) {
      const catalogVoices = selectedLocale === "ALL" 
        ? ORIGINAL_APP_VOICES 
        : ORIGINAL_APP_VOICES.filter((v) => v.locale === selectedLocale);

      if (catalogVoices.length > 0) {
        const optGroupCatalog = document.createElement("optgroup");
        optGroupCatalog.label = "⭐ Voces Neurales (Servidor Local / edge-tts)";
        catalogVoices.forEach((cv) => {
          const opt = document.createElement("option");
          opt.value = cv.shortName;
          opt.setAttribute("data-gender", cv.gender);
          opt.setAttribute("data-locale", cv.locale);
          const icon = cv.gender === "Hombre" ? "👨" : "👩";
          opt.textContent = `${icon} ${cv.shortName} · ${cv.gender} · ${cv.locale}`;
          optGroupCatalog.appendChild(opt);
        });
        voiceSelect.appendChild(optGroupCatalog);
      }
    }

    // 2. VOCES NATIVAS DEL NAVEGADOR (Web Speech API del sistema)
    // En la web son las voces principales; en local son alternativas secundarias.
    if (allSpVoices.length > 0) {
      let browserMatches = allSpVoices;
      if (selectedLocale !== "ALL") {
        const target = selectedLocale.toLowerCase();
        browserMatches = allSpVoices.filter((v) => (v.lang || "").toLowerCase().startsWith(target));
        // Si no hay del país específico en modo web, mostrar las voces no-desktop generales
        if (browserMatches.length === 0 && !hasNeuralServer) {
          browserMatches = allSpVoices.filter(v => !(v.name || "").toLowerCase().includes("desktop"));
          if (browserMatches.length === 0) browserMatches = allSpVoices;
        }
      }

      if (browserMatches.length > 0) {
        const optGroupBrowser = document.createElement("optgroup");
        optGroupBrowser.label = hasNeuralServer 
          ? "🌐 Voces del Navegador / Sistema" 
          : "🌐 Voces Disponibles en tu Navegador";
        
        browserMatches.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voiceURI;
          const gender = getGenderFromVoiceName(v.name);
          opt.setAttribute("data-gender", gender);
          opt.setAttribute("data-locale", v.lang || selectedLocale);
          const icon = gender === "Hombre" ? "👨" : "👩";
          const isNatural = (v.name || "").toLowerCase().includes("natural") || 
                           (v.name || "").toLowerCase().includes("online") || 
                           (v.name || "").toLowerCase().includes("google");
          const badge = isNatural ? "★ Fluida" : "Estándar";
          opt.textContent = `${icon} ${v.name} (${badge})`;
          optGroupBrowser.appendChild(opt);
        });
        voiceSelect.appendChild(optGroupBrowser);
      }
    }

    // 3. Fallback si no hay ninguna voz disponible aún
    if (voiceSelect.options.length === 0) {
      const opt = document.createElement("option");
      if (hasNeuralServer) {
        opt.value = "es-CR-JuanNeural";
        opt.setAttribute("data-gender", "Hombre");
        opt.setAttribute("data-locale", "es-CR");
        opt.textContent = "👨 es-CR-JuanNeural · Hombre · es-CR";
      } else {
        opt.value = "";
        opt.textContent = "Cargando voces del navegador...";
      }
      voiceSelect.appendChild(opt);
    }

    // Restaurar selección previa si existe
    let restored = false;
    if (prevVoiceValue) {
      for (let i = 0; i < voiceSelect.options.length; i++) {
        if (voiceSelect.options[i].value === prevVoiceValue) {
          voiceSelect.selectedIndex = i;
          restored = true;
          break;
        }
      }
    }
    if (!restored && voiceSelect.options.length > 0) {
      voiceSelect.selectedIndex = 0;
    }

    applyVoiceSettings(false);
  }

  function applyVoiceSettings(restartIfPlaying = true) {
    if (voiceSelect.selectedIndex < 0) return;
    const selectedOption = voiceSelect.options[voiceSelect.selectedIndex];
    const gender = selectedOption ? (selectedOption.getAttribute("data-gender") || "Hombre") : "Hombre";
    const loc = (selectedOption ? selectedOption.getAttribute("data-locale") : null) || localeFilter.value;
    const voiceVal = voiceSelect.value;
    const localeVal = loc && loc !== "ALL" ? loc : "es-CR";

    ttsEngine.setVoice(voiceVal, localeVal, gender);
    ttsEngine.rate = parseFloat(rateSlider.value) || 1.0;
    ttsEngine.pitch = parseFloat(pitchSlider.value) || 1.0;
    ttsEngine.volume = parseFloat(volumeSlider.value) || 1.0;

    if (restartIfPlaying && ttsEngine.isPlaying && !ttsEngine.isPaused) {
      ttsEngine.restartCurrentSentence();
    }
  }

  // Vincular eventos del motor TTS a la interfaz
  ttsEngine.onVoicesLoaded = () => updateVoiceUI();
  ttsEngine.onServerStatusKnown = () => updateVoiceUI();

  localeFilter.addEventListener("change", () => {
    renderFilteredVoices();
    applyVoiceSettings(true);
  });
  voiceSelect.addEventListener("change", () => {
    applyVoiceSettings(true);
  });

  // Inicializar UI de voces de inmediato
  updateVoiceUI();

  // Sliders de Ajustes con respuesta auditiva inmediata
  rateSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    ttsEngine.rate = val;
    rateVal.textContent = `${val.toFixed(1)}x`;
    if (ttsEngine.isPlaying && !ttsEngine.isPaused) {
      ttsEngine.restartCurrentSentence();
    }
  });

  pitchSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    ttsEngine.pitch = val;
    pitchVal.textContent = `${val.toFixed(1)}`;
    if (ttsEngine.isPlaying && !ttsEngine.isPaused) {
      ttsEngine.restartCurrentSentence();
    }
  });

  volumeSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    ttsEngine.volume = val;
    volumeVal.textContent = `${Math.round(val * 100)}%`;
  });

  // =========================================================================
  // 6. Controles de Reproducción TTS
  // =========================================================================
  btnBigPlay.addEventListener("click", () => {
    const text = mainTextarea.value.trim();
    if (!text) {
      showToast("Escribe o carga algún texto antes de escuchar.", "info");
      return;
    }

    if (ttsEngine.isPlaying) {
      // Pausar la lectura en vez de reiniciar
      ttsEngine.pause();
    } else if (ttsEngine.isPaused && ttsEngine.originalText === text) {
      // Reanudar la lectura exactamente donde se pausó
      ttsEngine.resume();
    } else {
      // Iniciar nueva lectura
      applyVoiceSettings(false);
      ttsEngine.loadText(text);
      buildReadingViewer();
      ttsEngine.play(0);
    }
  });

  btnPause.addEventListener("click", () => ttsEngine.pause());
  btnResume.addEventListener("click", () => ttsEngine.resume());
  btnStop.addEventListener("click", () => ttsEngine.stop());
  btnPrev.addEventListener("click", () => ttsEngine.previousSentence());
  btnNext.addEventListener("click", () => ttsEngine.nextSentence());

  // Callbacks del Motor TTS
  ttsEngine.onStateChange = ({ isPlaying, isPaused, currentIndex, total }) => {
    if (isPlaying) {
      btnBigPlay.innerHTML = `<span>⏸</span> <span>Pausar Lectura</span>`;
      btnBigPlay.classList.add("is-playing");
      visualizerBars.classList.add("is-playing");
      statusDot.className = "status-dot active";
      statusText.textContent = "Reproduciendo texto en voz alta...";
    } else if (isPaused) {
      btnBigPlay.innerHTML = `<span>▶</span> <span>Reanudar Lectura</span>`;
      btnBigPlay.classList.remove("is-playing");
      visualizerBars.classList.remove("is-playing");
      statusDot.className = "status-dot";
      statusText.textContent = "Lectura pausada.";
    } else {
      btnBigPlay.innerHTML = `<span>▶</span> <span>Escuchar Texto Ahora</span>`;
      btnBigPlay.classList.remove("is-playing");
      visualizerBars.classList.remove("is-playing");
      statusDot.className = "status-dot";
      statusText.textContent = "Listo para reproducir.";
    }

    const pct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressPercent.textContent = `${pct}%`;
    progressText.textContent = total > 0 ? `Frase ${currentIndex + 1} de ${total}` : `0 / 0 frases`;
  };

  ttsEngine.onSentenceStart = ({ index, total, rawText, phoneticText }) => {
    highlightReadingSentence(index);
  };

  ttsEngine.onFinish = () => {
    showToast("Lectura completada.", "success");
    progressFill.style.width = "100%";
    progressPercent.textContent = "100%";
  };

  function setDownloadLoading(loading, message = "") {
    if (loading) {
      btnDownloadAudio.disabled = true;
      btnDownloadAudio.classList.add("btn-disabled");
      if (downloadBtnIcon) downloadBtnIcon.textContent = "⏳";
      if (downloadBtnText) downloadBtnText.textContent = "Sintetizando Audio...";
      if (downloadLoadingBox) downloadLoadingBox.style.display = "block";
      if (downloadLoadingText && message) downloadLoadingText.textContent = message;
      if (downloadSubtext) downloadSubtext.style.display = "none";
    } else {
      btnDownloadAudio.disabled = false;
      btnDownloadAudio.classList.remove("btn-disabled");
      if (downloadBtnIcon) downloadBtnIcon.textContent = "💾";
      if (downloadBtnText) downloadBtnText.textContent = "Descargar Archivo de Audio";
      if (downloadLoadingBox) downloadLoadingBox.style.display = "none";
      if (downloadSubtext) downloadSubtext.style.display = "block";
    }
  }

  // Descarga de Archivo de Audio con Indicador de Carga y Barra de Progreso
  btnDownloadAudio.addEventListener("click", async () => {
    const text = mainTextarea.value.trim();
    if (!text) {
      showToast("Escribe o carga algún texto antes de descargar el audio.", "info");
      return;
    }

    applyVoiceSettings(false);

    const selectedOption = voiceSelect.options[voiceSelect.selectedIndex];
    const gender = selectedOption ? (selectedOption.getAttribute("data-gender") || "Hombre") : "Hombre";
    const voiceVal = voiceSelect.value;
    const pitchVal = parseFloat(pitchSlider.value) || 1.0;
    const rateVal = parseFloat(rateSlider.value) || 1.0;
    const localeVal = localeFilter.value;

    setDownloadLoading(true, "Sintetizando voz neural y preparando descarga... por favor espera");
    showToast("Sintetizando archivo de audio neural...", "info");

    // Obtener nombre personalizado o derivado del documento cargado
    let customBaseName = ttsOutputFilename ? ttsOutputFilename.value.trim() : "";
    if (!customBaseName) {
      customBaseName = currentLoadedDocName || "audio_sintetizado";
    }
    customBaseName = customBaseName.replace(/[/\\?%*:|"<>]/g, "_");
    const mp3Filename = customBaseName.toLowerCase().endsWith(".mp3") ? customBaseName : `${customBaseName}.mp3`;
    const wavFilename = customBaseName.toLowerCase().endsWith(".wav") ? customBaseName : `${customBaseName}.wav`;

    try {
      // 1. Si el servidor local Python de edge-tts está activo, descargar MP3 neural de alta fidelidad
      if (ttsEngine.useNeuralServer) {
        try {
          const resp = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: text,
              rules: pronManager.rules,
              voice: voiceVal,
              rate: rateVal,
              pitch: pitchVal,
              volume: 1.0,
              filename: mp3Filename
            })
          });

          if (!resp.ok) {
            throw new Error(`HTTP error ${resp.status}`);
          }

          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = url;
          a.download = mp3Filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 1000);

          showToast(`✓ Archivo neural "${mp3Filename}" descargado exitosamente.`, "success");
          return;
        } catch (err) {
          console.warn("Error en /api/download, usando fallback:", err);
        }
      }

      // 2. Fallback si no está el servidor Python local
      audioExporter.downloadAudioFile(
        text,
        {
          gender: gender,
          pitch: pitchVal,
          rate: rateVal,
          locale: localeVal,
          pronManager: pronManager
        },
        wavFilename
      );
      showToast(`✓ Archivo "${wavFilename}" descargado exitosamente.`, "success");
    } catch (err) {
      console.error("Error al exportar audio:", err);
      showToast("Error al exportar el archivo de audio: " + err.message, "error");
    } finally {
      setDownloadLoading(false);
    }
  });

  // Atajos de teclado útiles
  document.addEventListener("keydown", (e) => {
    // Si el foco está en un campo de texto, no interceptar Espacio
    if (document.activeElement === mainTextarea || document.activeElement === inputWritten || document.activeElement === inputSpoken || document.activeElement === dictSearch) {
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      btnBigPlay.click();
    } else if (e.code === "Escape") {
      ttsEngine.stop();
    } else if (e.code === "ArrowRight") {
      ttsEngine.nextSentence();
    } else if (e.code === "ArrowLeft") {
      ttsEngine.previousSentence();
    }
  });

  // =========================================================================
  // 7. Modal del Diccionario Fonético
  // =========================================================================
  function updateDictBadge() {
    const count = pronManager.rules.length;
    dictCountBadge.textContent = `${count} reglas activas`;
  }

  function renderDictTable(filter = "") {
    dictTableBody.innerHTML = "";
    const filterLower = filter.trim().toLowerCase();

    pronManager.rules.forEach(([written, spoken], index) => {
      if (filterLower) {
        if (!written.toLowerCase().includes(filterLower) && !spoken.toLowerCase().includes(filterLower)) {
          return;
        }
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight: 600; color: #f8fafc;">${escapeHtml(written)}</td>
        <td style="color: #38bdf8; font-family: var(--font-mono);">${escapeHtml(spoken)}</td>
        <td style="text-align: right;">
          <button class="btn btn-danger btn-icon btn-sm" data-index="${index}" title="Eliminar regla">✕</button>
        </td>
      `;

      tr.querySelector("button").addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        pronManager.removeRule(idx);
        renderDictTable(dictSearch.value);
        updateDictBadge();
        showToast("Regla eliminada.", "info");
      });

      dictTableBody.appendChild(tr);
    });

    updateDictBadge();
  }

  function escapeHtml(string) {
    const div = document.createElement("div");
    div.textContent = string;
    return div.innerHTML;
  }

  btnAddRule.addEventListener("click", () => {
    const w = inputWritten.value.trim();
    const s = inputSpoken.value.trim();
    if (!w || !s) {
      showToast("Escribe tanto el texto original como cómo debe sonar.", "error");
      return;
    }
    pronManager.addRule(w, s);
    inputWritten.value = "";
    inputSpoken.value = "";
    renderDictTable(dictSearch.value);
    updateDictBadge();
    showToast(`Regla agregada: "${w}" → "${s}"`, "success");
  });

  dictSearch.addEventListener("input", (e) => renderDictTable(e.target.value));

  btnOpenDict.addEventListener("click", () => {
    renderDictTable();
    dictModal.classList.add("open");
  });

  btnCloseDict.addEventListener("click", () => dictModal.classList.remove("open"));

  dictModal.addEventListener("click", (e) => {
    if (e.target === dictModal) dictModal.classList.remove("open");
  });

  btnResetDict.addEventListener("click", () => {
    if (confirm("¿Deseas restablecer el diccionario a sus valores predeterminados?")) {
      pronManager.restoreDefaultRules();
      renderDictTable();
      updateDictBadge();
      showToast("Diccionario restablecido con éxito.", "success");
    }
  });

  btnExportExcel.addEventListener("click", () => {
    try {
      pronManager.exportToExcel();
      showToast("Diccionario exportado a Excel.", "success");
    } catch (e) {
      showToast("Error al exportar: " + e.message, "error");
    }
  });

  btnExportJSON.addEventListener("click", () => {
    pronManager.exportToJSON();
    showToast("Diccionario exportado a JSON.", "success");
  });

  btnImportExcel.addEventListener("click", () => excelFileInput.click());

  excelFileInput.addEventListener("change", async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const res = await pronManager.importFromExcel(file);
        renderDictTable();
        updateDictBadge();
        showToast(`Importación completada: ${res.imported} agregadas, ${res.skipped} omitidas.`, "success");
      } catch (err) {
        showToast("Error al importar Excel: " + err.message, "error");
      } finally {
        excelFileInput.value = "";
      }
    }
  });

  // Modal de Ayuda
  btnOpenHelp.addEventListener("click", () => helpModal.classList.add("open"));
  btnCloseHelp.addEventListener("click", () => helpModal.classList.remove("open"));
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.classList.remove("open");
  });

  // Modal Acerca de / About (Ambystoma Technologies)
  const btnOpenAbout = document.getElementById("btnOpenAbout");
  const btnCloseAbout = document.getElementById("btnCloseAbout");
  const aboutModal = document.getElementById("aboutModal");

  if (btnOpenAbout && aboutModal) {
    btnOpenAbout.addEventListener("click", () => aboutModal.classList.add("open"));
    if (btnCloseAbout) {
      btnCloseAbout.addEventListener("click", () => aboutModal.classList.remove("open"));
    }
    aboutModal.addEventListener("click", (e) => {
      if (e.target === aboutModal) aboutModal.classList.remove("open");
    });
  }

  // =========================================================================
  // 8. Conmutador de Modos: Texto a Voz vs Transcribir Audio
  // =========================================================================
  const navBtnTTS = document.getElementById("navBtnTTS");
  const navBtnTranscribe = document.getElementById("navBtnTranscribe");
  const viewTTS = document.getElementById("viewTTS");
  const viewTranscribe = document.getElementById("viewTranscribe");

  function switchMode(mode) {
    if (mode === "tts") {
      navBtnTTS.classList.add("active");
      navBtnTranscribe.classList.remove("active");
      viewTTS.classList.remove("hidden");
      viewTranscribe.classList.add("hidden");
    } else {
      navBtnTranscribe.classList.add("active");
      navBtnTTS.classList.remove("active");
      viewTranscribe.classList.remove("hidden");
      viewTTS.classList.add("hidden");
    }
  }

  navBtnTTS.addEventListener("click", () => switchMode("tts"));
  navBtnTranscribe.addEventListener("click", () => switchMode("transcribe"));

  // =========================================================================
  // 9. Controlador del Módulo de Transcripción de Audio
  // =========================================================================
  const transcriber = new window.AudioTranscriber();

  const audioFileInput = document.getElementById("audioFileInput");
  const audioDropzone = document.getElementById("audioDropzone");
  const audioFilesListContainer = document.getElementById("audioFilesListContainer");
  const audioFilesCountBadge = document.getElementById("audioFilesCountBadge");
  const btnClearAudioFiles = document.getElementById("btnClearAudioFiles");
  const audioFilesList = document.getElementById("audioFilesList");
  const audioPlayerWrapper = document.getElementById("audioPlayerWrapper");
  const audioPreviewPlayer = document.getElementById("audioPreviewPlayer");

  const fileTranscribeActionWrapper = document.getElementById("fileTranscribeActionWrapper");
  const btnTranscribeFile = document.getElementById("btnTranscribeFile");
  const btnTranscribeFileIcon = document.getElementById("btnTranscribeFileIcon");
  const btnTranscribeFileText = document.getElementById("btnTranscribeFileText");
  const fileTranscribeLoadingBox = document.getElementById("fileTranscribeLoadingBox");
  const fileTranscribeLoadingText = document.getElementById("fileTranscribeLoadingText");
  const fileTranscribeProgressPct = document.getElementById("fileTranscribeProgressPct");
  const fileTranscribeRealProgressBar = document.getElementById("fileTranscribeRealProgressBar");
  const fileTranscribeTimeDisplay = document.getElementById("fileTranscribeTimeDisplay");
  let uploadedAudioFiles = [];

  const btnToggleRecord = document.getElementById("btnToggleRecord");
  const btnRecordText = document.getElementById("btnRecordText");
  const recStatusDot = document.getElementById("recStatusDot");
  const recTimerDisplay = document.getElementById("recTimerDisplay");
  const btnSpeaker1 = document.getElementById("btnSpeaker1");
  const btnSpeaker2 = document.getElementById("btnSpeaker2");

  const transcribeLangSelect = document.getElementById("transcribeLangSelect");
  const chkDifferentiateSpeakers = document.getElementById("chkDifferentiateSpeakers");
  const chkIncludeTimestamps = document.getElementById("chkIncludeTimestamps");
  const transcriptionOutput = document.getElementById("transcriptionOutput");
  const transcribeWordCount = document.getElementById("transcribeWordCount");

  const btnExportTxt = document.getElementById("btnExportTxt");
  const btnCopyTranscript = document.getElementById("btnCopyTranscript");
  const btnSendToTTS = document.getElementById("btnSendToTTS");
  const btnClearTranscript = document.getElementById("btnClearTranscript");

  // Configuración inicial de transcripción
  if (!transcriber.hasSupport) {
    btnRecordText.textContent = "Micrófono no soportado en este navegador";
    btnToggleRecord.disabled = true;
    showToast("Para dictado por micrófono, se recomienda Google Chrome o Microsoft Edge.", "error");
  }

  transcribeLangSelect.addEventListener("change", (e) => {
    transcriber.setLanguage(e.target.value);
  });

  chkDifferentiateSpeakers.addEventListener("change", (e) => {
    transcriber.differentiateSpeakers = e.target.checked;
    transcriptionOutput.value = transcriber.getFormattedText();
  });

  chkIncludeTimestamps.addEventListener("change", (e) => {
    transcriber.includeTimestamps = e.target.checked;
    transcriptionOutput.value = transcriber.getFormattedText();
  });

  // Selector de Hablante Activo
  function setSpeaker(speakerNum) {
    transcriber.currentSpeaker = speakerNum;
    if (speakerNum === 1) {
      btnSpeaker1.classList.add("active");
      btnSpeaker2.classList.remove("active");
    } else {
      btnSpeaker2.classList.add("active");
      btnSpeaker1.classList.remove("active");
    }
  }

  btnSpeaker1.addEventListener("click", () => setSpeaker(1));
  btnSpeaker2.addEventListener("click", () => setSpeaker(2));

  // Iniciar / Detener Grabación por Micrófono
  btnToggleRecord.addEventListener("click", () => {
    if (transcriber.isRecording) {
      transcriber.stopRecording();
    } else {
      try {
        transcriber.startRecording();
      } catch (err) {
        showToast(err.message || "Error al acceder al micrófono.", "error");
      }
    }
  });

  transcriber.onStateChange = ({ isRecording }) => {
    if (isRecording) {
      btnToggleRecord.classList.add("is-recording");
      btnRecordText.textContent = "Detener Grabación y Transcripción";
      recStatusDot.className = "status-dot active";
      showToast("Grabando y transcribiendo en vivo...", "info");
    } else {
      btnToggleRecord.classList.remove("is-recording");
      btnRecordText.textContent = "Iniciar Grabación y Transcripción";
      recStatusDot.className = "status-dot";
    }
  };

  transcriber.onTimeUpdate = (timeFormatted) => {
    recTimerDisplay.textContent = timeFormatted;
  };

  transcriber.onResult = ({ fullText, interimText }) => {
    if (interimText) {
      transcriptionOutput.value = fullText + (fullText ? "\n\n" : "") + "⏳ [Procesando...] " + interimText;
    } else {
      transcriptionOutput.value = fullText;
    }
    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;

    // Actualizar conteo de palabras
    const words = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
    transcribeWordCount.textContent = `${words.toLocaleString()} palabras`;
  };

  transcriber.onError = (error) => {
    if (error === "not-allowed") {
      showToast("Permiso de micrófono denegado. Permite el acceso para transcribir.", "error");
    } else if (error === "no-speech") {
      // Ignorar silencio
    } else {
      showToast("Aviso de reconocimiento: " + error, "info");
    }
  };

  // Carga de Múltiples Archivos de Audio (Drag & Drop + Input)
  audioDropzone.addEventListener("click", () => audioFileInput.click());

  audioDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    audioDropzone.classList.add("dragover");
  });

  audioDropzone.addEventListener("dragleave", () => {
    audioDropzone.classList.remove("dragover");
  });

  audioDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    audioDropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAudioFiles(Array.from(e.dataTransfer.files));
    }
  });

  audioFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAudioFiles(Array.from(e.target.files));
      audioFileInput.value = "";
    }
  });

  function formatSecondsToMMSS(sec) {
    const s = Math.round(sec || 0);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function handleAudioFiles(files) {
    const validFiles = files.filter(f => 
      f.type.startsWith("audio/") || f.name.match(/\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i)
    );

    if (validFiles.length === 0) {
      showToast("Por favor selecciona archivos de audio válidos (.mp3, .wav, .m4a, .ogg, .flac).", "error");
      return;
    }

    let addedCount = 0;
    validFiles.forEach(vf => {
      // Evitar duplicados exactos (mismo nombre y tamaño)
      if (!uploadedAudioFiles.some(f => f.name === vf.name && f.size === vf.size)) {
        uploadedAudioFiles.push(vf);
        addedCount++;
      }
    });

    renderAudioFilesList();

    if (addedCount > 0) {
      showToast(`${addedCount} ${addedCount === 1 ? 'audio añadido' : 'audios añadidos'}. Total en cola: ${uploadedAudioFiles.length}.`, "info");
    }
  }

  function renderAudioFilesList() {
    if (!audioFilesList || !audioFilesListContainer) return;
    audioFilesList.innerHTML = "";

    const total = uploadedAudioFiles.length;
    if (total === 0) {
      audioFilesListContainer.style.display = "none";
      if (audioPlayerWrapper) audioPlayerWrapper.style.display = "none";
      if (fileTranscribeActionWrapper) fileTranscribeActionWrapper.style.display = "none";
      return;
    }

    audioFilesListContainer.style.display = "block";
    if (fileTranscribeActionWrapper) {
      fileTranscribeActionWrapper.style.display = "block";
      if (btnTranscribeFile) btnTranscribeFile.disabled = false;
      if (fileTranscribeLoadingBox) fileTranscribeLoadingBox.style.display = "none";
    }

    if (audioFilesCountBadge) {
      const totalBytes = uploadedAudioFiles.reduce((acc, f) => acc + f.size, 0);
      const mb = (totalBytes / (1024 * 1024)).toFixed(1);
      audioFilesCountBadge.textContent = `${total} ${total === 1 ? 'archivo de audio listo' : 'archivos de audio listos'} (${mb} MB)`;
    }

    if (btnTranscribeFileText) {
      btnTranscribeFileText.textContent = total > 1
        ? `Proceder a Transcribir ${total} Archivos de Audio`
        : "Proceder a Transcribir Archivo";
    }

    uploadedAudioFiles.forEach((file, idx) => {
      const item = document.createElement("div");
      item.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 6px; padding: 0.4rem 0.65rem; font-size: 0.82rem;";

      const info = document.createElement("div");
      info.style.cssText = "display: flex; align-items: center; gap: 0.45rem; min-width: 0; flex: 1; cursor: pointer;";
      info.title = `Clic para escuchar "${file.name}"`;
      info.innerHTML = `
        <span style="color: #fb7185;">🎵</span>
        <span style="font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>
        <span style="color: #94a3b8; font-size: 0.72rem; flex-shrink: 0;">(${Math.round(file.size / 1024)} KB)</span>
      `;
      info.addEventListener("click", () => {
        if (audioPreviewPlayer && audioPlayerWrapper) {
          audioPreviewPlayer.src = URL.createObjectURL(file);
          audioPlayerWrapper.style.display = "block";
          audioPreviewPlayer.play().catch(() => {});
        }
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.style.cssText = "background: none; border: none; color: #ef4444; font-size: 0.85rem; cursor: pointer; padding: 0.1rem 0.35rem; border-radius: 4px;";
      delBtn.title = "Quitar este archivo";
      delBtn.innerHTML = "✕";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        uploadedAudioFiles.splice(idx, 1);
        renderAudioFilesList();
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      audioFilesList.appendChild(item);
    });

    // Cargar el primer audio en el reproductor si está disponible
    if (uploadedAudioFiles.length > 0 && audioPreviewPlayer && audioPlayerWrapper) {
      audioPreviewPlayer.src = URL.createObjectURL(uploadedAudioFiles[0]);
      audioPlayerWrapper.style.display = "block";
    }
  }

  if (btnClearAudioFiles) {
    btnClearAudioFiles.addEventListener("click", () => {
      uploadedAudioFiles = [];
      renderAudioFilesList();
      showToast("Lista de audios vaciada.", "info");
    });
  }

  // Listener para el botón de Proceder a Transcribir Múltiples Archivos de Audio
  if (btnTranscribeFile) {
    btnTranscribeFile.addEventListener("click", async () => {
      if (!uploadedAudioFiles || uploadedAudioFiles.length === 0) {
        showToast("Por favor selecciona o arrastra al menos un archivo de audio para transcribir.", "info");
        if (audioFileInput) audioFileInput.click();
        return;
      }

      const totalFiles = uploadedAudioFiles.length;

      btnTranscribeFile.disabled = true;
      if (btnTranscribeFileIcon) btnTranscribeFileIcon.textContent = "⏳";
      if (btnTranscribeFileText) btnTranscribeFileText.textContent = totalFiles > 1 ? `Transcribiendo (0/${totalFiles})...` : "Transcribiendo audio...";
      if (fileTranscribeLoadingBox) fileTranscribeLoadingBox.style.display = "block";
      if (fileTranscribeProgressPct) fileTranscribeProgressPct.textContent = "0%";
      if (fileTranscribeRealProgressBar) fileTranscribeRealProgressBar.style.width = "0%";
      if (fileTranscribeTimeDisplay) fileTranscribeTimeDisplay.textContent = "Tiempo: 00:00 / 00:00";
      
      // Limpiar el área de texto para ver la transcripción en vivo
      if (transcriptionOutput) transcriptionOutput.value = "";
      if (transcribeWordCount) transcribeWordCount.textContent = "0 palabras";

      const lang = transcribeLangSelect ? transcribeLangSelect.value : "es-CR";
      const diarize = chkDifferentiateSpeakers ? (chkDifferentiateSpeakers.checked ? "1" : "0") : "1";
      const timestamps = chkIncludeTimestamps ? (chkIncludeTimestamps.checked ? "1" : "0") : "1";

      let accumulatedTranscripts = [];

      // Procesar archivo por archivo en cola secuencial para no saturar memoria RAM
      for (let i = 0; i < totalFiles; i++) {
        const file = uploadedAudioFiles[i];
        const fileHeaderTitle = totalFiles > 1 
          ? `════════════════════════════════════════\n📄 Transcripción: ${file.name}\n════════════════════════════════════════\n\n`
          : "";

        if (fileTranscribeLoadingText) {
          fileTranscribeLoadingText.textContent = totalFiles > 1 
            ? `Transcribiendo ${i + 1}/${totalFiles}: "${file.name}"...`
            : `Transcribiendo "${file.name}" con Whisper IA...`;
        }

        try {
          const query = new URLSearchParams({
            lang: lang,
            diarize: diarize,
            timestamps: timestamps,
            filename: file.name
          });

          const res = await fetch(`/api/transcribe?${query.toString()}`, {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "X-Language": lang,
              "X-Diarize": diarize,
              "X-Timestamps": timestamps,
              "X-Filename": encodeURIComponent(file.name)
            },
            body: file
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Error del servidor (${res.status})`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let buffer = "";
          let currentFileText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const messages = buffer.split("\n\n");
            buffer = messages.pop() || "";

            for (const msg of messages) {
              const trimmed = msg.trim();
              if (!trimmed.startsWith("data:")) continue;
              const jsonStr = trimmed.replace(/^data:\s*/, "");
              try {
                const event = JSON.parse(jsonStr);

                if (event.type === "status") {
                  if (fileTranscribeLoadingText && event.message) {
                    const prefix = totalFiles > 1 ? `[${i + 1}/${totalFiles}] ` : "";
                    fileTranscribeLoadingText.textContent = `${prefix}${event.message}`;
                  }
                  if (event.current_time && event.total_time && fileTranscribeTimeDisplay) {
                    fileTranscribeTimeDisplay.textContent = `Tiempo: ${event.current_time} / ${event.total_time}`;
                  }
                } else if (event.type === "segment") {
                  currentFileText = event.full_text || currentFileText;

                  // Progreso global acumulativo
                  const fileProgress = Math.min(99, Math.max(0, event.progress || 0));
                  const globalPct = Math.round(((i + (fileProgress / 100)) / totalFiles) * 100);
                  if (fileTranscribeRealProgressBar) fileTranscribeRealProgressBar.style.width = `${globalPct}%`;
                  if (fileTranscribeProgressPct) fileTranscribeProgressPct.textContent = `${globalPct}%`;

                  if (event.current_time && event.total_time && fileTranscribeTimeDisplay) {
                    fileTranscribeTimeDisplay.textContent = `Tiempo: ${event.current_time} / ${event.total_time}`;
                  }

                  // Mostrar texto acumulado de los archivos completados + el archivo en curso
                  let livePreview = "";
                  if (accumulatedTranscripts.length > 0) {
                    livePreview = accumulatedTranscripts.join("\n\n\n") + "\n\n\n";
                  }
                  livePreview += fileHeaderTitle + currentFileText;

                  if (transcriptionOutput) {
                    transcriptionOutput.value = livePreview;
                    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
                  }
                  if (transcribeWordCount) {
                    const words = livePreview.trim() ? livePreview.trim().split(/\s+/).length : 0;
                    transcribeWordCount.textContent = `${words.toLocaleString()} palabras`;
                  }
                } else if (event.type === "done") {
                  currentFileText = event.full_text || currentFileText;
                } else if (event.type === "error") {
                  throw new Error(event.error || "Error durante la transcripción");
                }
              } catch (parseErr) {
                console.warn("Aviso parseando chunk de transcripción:", parseErr);
              }
            }
          }

          // Guardar el bloque completado de este archivo
          const finalFileBlock = fileHeaderTitle + (currentFileText.trim() || "[Sin audio o voz detectable en este archivo]");
          accumulatedTranscripts.push(finalFileBlock);

          // Actualizar barra al terminar este archivo
          const completedPct = Math.round(((i + 1) / totalFiles) * 100);
          if (fileTranscribeRealProgressBar) fileTranscribeRealProgressBar.style.width = `${completedPct}%`;
          if (fileTranscribeProgressPct) fileTranscribeProgressPct.textContent = `${completedPct}%`;

        } catch (err) {
          console.warn(`Error transcribiendo ${file.name}:`, err);
          const errBlock = fileHeaderTitle + `[Error al procesar este archivo: ${err.message}]`;
          accumulatedTranscripts.push(errBlock);
          showToast(`Error en "${file.name}": ${err.message}`, "error");
        }
      }

      // Consolidar todos los textos en el área de salida
      const fullCombinedText = accumulatedTranscripts.join("\n\n\n");
      if (transcriptionOutput) {
        transcriptionOutput.value = fullCombinedText;
        transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
      }
      if (transcribeWordCount) {
        const words = fullCombinedText.trim() ? fullCombinedText.trim().split(/\s+/).length : 0;
        transcribeWordCount.textContent = `${words.toLocaleString()} palabras`;
      }

      if (fileTranscribeRealProgressBar) fileTranscribeRealProgressBar.style.width = "100%";
      if (fileTranscribeProgressPct) fileTranscribeProgressPct.textContent = "100%";
      if (fileTranscribeLoadingText) fileTranscribeLoadingText.textContent = `¡Transcripción de ${totalFiles} ${totalFiles === 1 ? 'archivo' : 'archivos'} completada con éxito!`;

      showToast(`¡Transcripción completada de ${totalFiles} ${totalFiles === 1 ? 'archivo' : 'archivos'}!`, "success", 5000);

      btnTranscribeFile.disabled = false;
      if (btnTranscribeFileIcon) btnTranscribeFileIcon.textContent = "⚡";
      if (btnTranscribeFileText) btnTranscribeFileText.textContent = totalFiles > 1 ? `Proceder a Transcribir ${totalFiles} Archivos` : "Proceder a Transcribir Archivo";

      setTimeout(() => {
        if (fileTranscribeLoadingBox && !btnTranscribeFile.disabled) {
          fileTranscribeLoadingBox.style.display = "none";
        }
      }, 5000);
    });
  }

  // Exportar a .TXT (Descarga todos los textos sumados como un solo archivo)
  btnExportTxt.addEventListener("click", () => {
    try {
      const text = transcriptionOutput ? transcriptionOutput.value : "";
      if (!text.trim()) {
        showToast("No hay texto transcrito para guardar.", "info");
        return;
      }

      let filename = "transcripcion_audio.txt";
      if (uploadedAudioFiles && uploadedAudioFiles.length === 1) {
        const base = uploadedAudioFiles[0].name.replace(/\.[^/.]+$/, "");
        filename = `${base}_transcripcion.txt`;
      } else if (uploadedAudioFiles && uploadedAudioFiles.length > 1) {
        filename = `transcripcion_combinada_${uploadedAudioFiles.length}_audios.txt`;
      }

      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
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

      showToast(`Transcripción guardada como "${filename}".`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Copiar al Portapapeles
  btnCopyTranscript.addEventListener("click", async () => {
    const text = transcriptionOutput.value.trim();
    if (!text) {
      showToast("No hay texto para copiar.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("Transcripción copiada al portapapeles.", "success");
    } catch (e) {
      showToast("No se pudo copiar automáticamente.", "error");
    }
  });

  // Enviar a Texto a Voz (Interconexión de Módulos)
  btnSendToTTS.addEventListener("click", () => {
    const text = transcriptionOutput.value.trim();
    if (!text) {
      showToast("No hay texto para enviar.", "error");
      return;
    }

    // Copiar al cuadro de texto de TTS
    mainTextarea.value = text;
    updateTextStats();
    buildReadingViewer();

    // Cambiar a la vista de Texto a Voz
    switchMode("tts");
    showToast("¡Texto enviado al Lector de Voz con éxito!", "success");
  });

  // Limpiar Transcripción
  btnClearTranscript.addEventListener("click", () => {
    if (!transcriptionOutput.value.trim()) return;
    if (confirm("¿Deseas vaciar la transcripción actual?")) {
      transcriber.clearTranscription();
      transcribeWordCount.textContent = "0 palabras";
      showToast("Transcripción vaciada.", "info");
    }
  });

  // Inicialización de estado inicial
  updateTextStats();
  updateDictBadge();
});

# 🔊 Lector de voz & transcripciones · Ambystoma Technologies

Aplicación web moderna y responsiva que combina dos herramientas avanzadas en una sola suite 100% gratuita y privada:
1. **Lector de Ebooks y Textos a Voz (TTS)** con 22 acentos en español, voces masculinas y femeninas, y corrección fonética personalizada para libros y documentos (PDF, EPUB, Word DOCX, TXT, HTML).
2. **Transcriptor de Audio a Texto (STT)** con dictado por micrófono en tiempo real y transcriptor de archivos de audio (.mp3, .wav, .m4a, .ogg) con barra de progreso real, aparición de texto en vivo y diferenciación de hablantes (**Hablante 1 / Hablante 2**).

100% libre, sin registro, optimizada en **Modo Oscuro**, compatible con computadoras y teléfonos móviles, y lista para publicar gratis en **GitHub Pages**.

---

## ✨ Características Principales

### 🔊 Módulo 1: Texto a Voz (Ebooks & Documentos)
- **Lectura de múltiples formatos**: PDF (PDF.js), EPUB (JSZip), Word DOCX (Mammoth.js), TXT, Markdown, HTML, SRT.
- **Motor de Voz en el Navegador**: Voces en español fluidas (España, México, Costa Rica, etc.), ajuste de velocidad, tono y volumen.
- **Modo Lectura con Resaltado Sincronizado**: Sigue la lectura oración por oración en tiempo real con auto-scroll.
- **Corrección Fonética Personalizada**: Algoritmo en 3 capas que corrige nombres difíciles de fantasía (ej. `Rhyz` → `Rís`, `Azriel` → `Ázriel`).
- **Importar y Exportar Excel (.xlsx)**: Soporte completo para tu archivo `diccionario.xlsx`.

### 🎙️ Módulo 2: Transcriptor de Audio a Texto (Voz a Texto)
- **Dictado en Tiempo Real**: Graba y transcribe reuniones, conferencias o notas de voz directamente desde el micrófono con Web Speech Recognition.
- **Archivos de Audio**: Carga y reproduce archivos `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`.
- **Diferenciación de Hablantes**: Alterna o etiqueta diálogos entre **Hablante 1** y **Hablante 2**.
- **Marcas de Tiempo**: Inserta marcas automáticas de tiempo `[MM:SS]`.
- **Interconexión Directa**: Botón para enviar el texto transcrito con 1 clic al Lector de Voz para escucharlo de inmediato.
- **Exportación**: Guardar en `.txt` con codificación UTF-8 y copiar al portapapeles.

### 🌙 Diseño & Monetización
- **Modo Oscuro Premium**: Paleta Dark Slate moderna, glassmorphism, responsive para teléfonos móviles y escritorios.
- **Espacios Publicitarios Reservados**: 3 contenedores listos para insertar etiquetas de Google AdSense sin romper la interfaz.

---

## 🚀 Cómo publicar en GitHub Pages (Paso a Paso)

La aplicación no requiere compilación (`build`) ni instalación de paquetes (`npm`). Funciona directamente desde el navegador:

1. **Crear o usar tu repositorio de GitHub**:
   - Sube todos los archivos (`index.html`, carpeta `css/`, carpeta `js/`, etc.) a tu repositorio en GitHub:
   ```bash
   git init
   git add .
   git commit -m "Publicar LectorVoz Pro para Web y Móvil"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git push -u origin main
   ```

2. **Activar GitHub Pages**:
   - Entra a tu repositorio en GitHub.
   - Haz clic en **Settings** (Configuración) en la barra superior.
   - En el menú lateral izquierdo, haz clic en **Pages**.
   - En la sección **Build and deployment > Branch**:
     - Selecciona la rama: **`main`** (o `master`).
     - Selecciona la carpeta: **`/(root)`**.
     - Haz clic en **Save** (Guardar).

3. **¡Listo!**:
   - En aproximadamente 1 minuto, GitHub te proporcionará una URL pública similar a:
     `https://tu-usuario.github.io/tu-repositorio/`

---

## 💰 Cómo Configurar Google AdSense

En el archivo `index.html` están creados los tres contenedores con los siguientes identificadores:

- **Banner Superior**: `<div class="ad-container ad-header-banner" id="ad-slot-top">`
- **Banner Lateral**: `<div class="ad-container ad-sidebar-box" id="ad-slot-sidebar">`
- **Banner Inferior**: `<div class="ad-container ad-footer-banner" id="ad-slot-bottom">`

Para colocar anuncios reales:
1. Regístrate en [Google AdSense](https://www.google.com/adsense/).
2. Inserta el script principal de AdSense dentro de la etiqueta `<head>` de `index.html`:
   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXX" crossorigin="anonymous"></script>
   ```
3. Reemplaza el contenido interior de cada bloque de anuncio por tu código de anuncio:
   ```html
   <ins class="adsbygoogle"
        style="display:block"
        data-ad-client="ca-pub-XXXXXXXXXXXXX"
        data-ad-slot="1234567890"
        data-ad-format="auto"
        data-full-width-responsive="true"></ins>
   <script>
        (adsbygoogle = window.adsbygoogle || []).push({});
   </script>
   ```

---

## ⌨️ Atajos de Teclado

- **Barra Espaciadora**: Reproducir / Pausar lectura.
- **Esc**: Detener por completo.
- **Flecha Derecha (→)**: Pasar a la siguiente oración.
- **Flecha Izquierda (←)**: Regresar a la oración anterior.

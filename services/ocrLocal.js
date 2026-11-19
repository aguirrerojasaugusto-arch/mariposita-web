const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        const processedImage = await sharp(fileBuffer)
            .resize(2000, null, { withoutEnlargement: true }) 
            .grayscale()
            .normalize() 
            .toBuffer();

        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        console.log("=== TEXTO LEÍDO POR TESSERACT ===");
        console.log(text);
        console.log("==================================");

        // ⭐ 1. LIMPIEZA PROFUNDA DE TEXTO BASURA ⭐
        let cleanText = text;
        // Eliminar fechas (ej. "12 oct. 2026")
        cleanText = cleanText.replace(/\d{1,2}\s*(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s*\d{4}/gi, '');
        // Eliminar horas (ej. "10:00 a. m.")
        cleanText = cleanText.replace(/\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)/gi, '');
        // Eliminar números de celular enmascarados
        cleanText = cleanText.replace(/\*{3}\s*\*{3}\s*\d{3}/g, '');

        let monto = null;

        // ⭐ 2. BÚSQUEDA DEL MONTO ⭐
        // Buscar el patrón "S/" o "5/" (por si Tesseract confunde la S con 5)
        const matchSoles = cleanText.toLowerCase().match(/[s5]\s*[\/l]\s*(\d+(?:[.,]\d{1,2})?)/);
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        }

        // Respaldo: Si falla, buscar un número que esté SOLO en su propia línea
        if (monto === null) {
            const lines = cleanText.split('\n');
            for (let line of lines) {
                const trimmed = line.trim();
                // Si la línea es exactamente un número de 1 a 5 dígitos (ej. "15" o "15.00")
                if (/^\d{1,5}(?:[.,]\d{2})?$/.test(trimmed)) {
                    const val = parseFloat(trimmed.replace(',', '.'));
                    if (val >= 2020 && val <= 2030) continue; // Ignorar años por si acaso
                    monto = val;
                    break;
                }
            }
        }

        // ⭐ 3. EXTRACCIÓN DEL NÚMERO DE OPERACIÓN ⭐
        let operacion = null;
        const opMatches = text.match(/\b\d{6,9}\b/g);
        if (opMatches && opMatches.length > 0) {
            operacion = opMatches.sort((a, b) => b.length - a.length)[0]; 
        }

        return {
            monto,
            operacion,
            texto_completo: text,
            error_ocr: null
        };

    } catch (e) {
        console.error("Error OCR Local:", e.message);
        return { ...vacio, error_ocr: `Error OCR: ${e.message}` };
    }
}

module.exports = { extraerDatosLocal };
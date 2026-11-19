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

        // ⭐ 1. LIMPIEZA EXTREMA (Eliminamos horas, fechas y celulares) ⭐
        let cleanText = text;
        cleanText = cleanText.replace(/\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?/gi, ''); // Borra "10:00 a. m."
        cleanText = cleanText.replace(/\d{1,2}\s*(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s*\d{4}/gi, ''); // Borra "12 oct. 2026"
        cleanText = cleanText.replace(/\*{3}\s*\*{3}\s*\d{3}/g, ''); // Borra "*** *** 715"

        let monto = null;

        // ⭐ 2. BÚSQUEDA SIN ESPACIOS ⭐
        // Quitamos TODOS los espacios. Si Tesseract leyó "S / 1 5", lo convierte en "S/15"
        const textNoSpaces = cleanText.replace(/\s+/g, '').toLowerCase();
        
        // Busca "S/", "5/" o "$/" seguido de números
        const matchSoles = textNoSpaces.match(/[s5$][\/l]?([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)/);
        
        if (matchSoles && matchSoles[1]) {
            let raw = matchSoles[1].toUpperCase()
                .replace(/S/g, '5') // Corrige "1S" a "15"
                .replace(/O/g, '0') // Corrige "O" a "0"
                .replace(/I/g, '1'); // Corrige "I" a "1"
            let val = parseFloat(raw.replace(',', '.'));
            if (!isNaN(val) && val > 0) monto = val;
        }

        // ⭐ 3. RESPALDO: BUSCAR EN LÍNEAS LIMPIAS ⭐
        if (monto === null) {
            const lines = cleanText.split('\n');
            for (let line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                
                // Ignorar código de seguridad (3 números separados), operación, celular, etc.
                if (/^\d\s*\d\s*\d$/.test(trimmed)) continue;
                if (/operaci|celular|destino|seguridad|yapeaste/i.test(trimmed)) continue;

                // Si la línea es exactamente un número (ej. "15")
                const matchNum = trimmed.match(/^\b([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)\b$/i);
                if (matchNum) {
                    let raw = matchNum[1].toUpperCase().replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1');
                    let val = parseFloat(raw.replace(',', '.'));
                    // Ignorar años (2020 a 2035)
                    if (!isNaN(val) && val > 0 && val < 5000 && !(val >= 2020 && val <= 2035)) {
                        monto = val;
                        break;
                    }
                }
            }
        }

        // 4. NÚMERO DE OPERACIÓN
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
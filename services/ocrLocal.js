const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        const worker = await createWorker('spa');

        // 1. PREPROCESAMIENTO: Quitamos el fondo morado (trim) y mejoramos el contraste
        const processedImage = await sharp(fileBuffer)
            .trim() // ⭐ Elimina los bordes morados automáticamente
            .resize(1500, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .toBuffer();

        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        console.log("=== TEXTO LEÍDO (COMPLETO) ===");
        console.log(text);
        console.log("==============================");

        let monto = null;
        let operacion = null;

        // 2. LIMPIEZA DE TEXTO BASURA (Fechas, horas, celulares)
        let cleanText = text;
        // Borra "12 oct. 2026"
        cleanText = cleanText.replace(/\d{1,2}\s*(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s*\d{2,4}/gi, '');
        // Borra "10:00 a. m."
        cleanText = cleanText.replace(/\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?/gi, '');
        // Borra "*** *** 715"
        cleanText = cleanText.replace(/\*{3}\s*\*{3}\s*\d{3}/g, '');
        // Borra "CÓDIGO DE SEGURIDAD" para que no agarre el 7 8 4
        cleanText = cleanText.replace(/c[oó]digo de seguridad/gi, '');

        // 3. BÚSQUEDA DEL MONTO
        // Busca "S/ 15", "5/ 15" o "S/15"
        const matchSoles = cleanText.toLowerCase().match(/[s5$]\s*[\/l]\s*(\d+(?:[.,]\d{1,2})?)/);
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        } else {
            // Respaldo: Si Tesseract se comió la "S/", agarramos el primer número de 1 a 4 dígitos
            // que no sea un año (2020-2030) ni el número de operación.
            const numeros = cleanText.match(/\b\d{1,4}(?:[.,]\d{1,2})?\b/g);
            if (numeros) {
                for (let num of numeros) {
                    let val = parseFloat(num.replace(',', '.'));
                    // Excluir años
                    if (val >= 2020 && val <= 2030) continue;
                    // Excluir montos absurdamente altos (ej. 10008784)
                    if (val > 5000) continue;
                    
                    monto = val;
                    break; // El primero que encuentre será el monto
                }
            }
        }

        // 4. BÚSQUEDA DE LA OPERACIÓN
        // Buscamos números de 6 a 9 dígitos en el texto original (sin limpiar)
        const opMatches = text.match(/\b\d{6,9}\b/g);
        if (opMatches && opMatches.length > 0) {
            // Excluir años
            const validOps = opMatches.filter(op => {
                const v = parseInt(op);
                return !(v >= 2020 && v <= 2030);
            });
            if (validOps.length > 0) {
                operacion = validOps.sort((a, b) => b.length - a.length)[0]; 
            }
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
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        // Preprocesamiento: Escala de grises y contraste mejorado (sin recortes que fallen)
        const processedImage = await sharp(fileBuffer)
            .resize(2000, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .toBuffer();

        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        console.log("=== TEXTO ORIGINAL LEÍDO ===");
        console.log(text);

        let monto = null;
        let operacion = null;

        // --- EXTRACCIÓN DEL NÚMERO DE OPERACIÓN ---
        const opMatches = text.match(/\b\d{6,9}\b/g);
        if (opMatches && opMatches.length > 0) {
            const validOps = opMatches.filter(op => {
                const v = parseInt(op);
                return !(v >= 2020 && v <= 2030); // Ignorar años
            });
            if (validOps.length > 0) {
                operacion = validOps.sort((a, b) => b.length - a.length)[0]; 
            }
        }

        // ==========================================
        // 🤖 EL ROBOT DE LIMPIEZA EXTREMA 🤖
        // ==========================================
        let cleanText = text;

        // 1. Quitar "Nro. de operación" y el número que le sigue
        cleanText = cleanText.replace(/nro\.?\s*de\s*operac[a-z0-9]*[\s\S]{0,20}/gi, '');
        
        // 2. Quitar "Nro. de celular" y el número que le sigue
        cleanText = cleanText.replace(/nro\.?\s*de\s*celular[\s\S]{0,20}/gi, '');
        cleanText = cleanText.replace(/\*{3}\s*\*{3}\s*\d{3}/g, ''); // Quita *** *** 715

        // 3. Quitar "Destino Yape"
        cleanText = cleanText.replace(/destino[\s\S]{0,10}?yape/gi, '');

        // 4. Quitar "Código de seguridad" y los números separados (7 8 4)
        cleanText = cleanText.replace(/c[oó]digo\s*de\s*seguridad[\s\S]{0,20}/gi, '');
        cleanText = cleanText.replace(/(?:\b\d\s+){2,}\b\d\b/g, ''); 

        // 5. Quitar Fecha (ej. 12 oct. 2026)
        cleanText = cleanText.replace(/\d{1,2}\s*(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s*\d{2,4}/gi, '');

        // 6. Quitar Hora (ej. 10:00 a. m.)
        cleanText = cleanText.replace(/\b\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?/gi, '');

        // 7. Quitar Años por si acaso
        cleanText = cleanText.replace(/\b20[2-3]\d\b/g, '');

        console.log("=== TEXTO DESPUÉS DEL ROBOT ===");
        console.log(cleanText);

        // --- BÚSQUEDA DEL MONTO EN EL TEXTO LIMPIO ---
        // Buscamos el patrón "S/ 15" o "5/ 15" con corrección de errores OCR
        const matchSoles = cleanText.toLowerCase().match(/[s5$]\s*[\/l]?\s*([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)/);
        
        if (matchSoles && matchSoles[1]) {
            let raw = matchSoles[1].toUpperCase()
                .replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
            let val = parseFloat(raw.replace(',', '.'));
            if (!isNaN(val) && val > 0) monto = val;
        } else {
            // Si Tesseract se comió la "S/", buscamos CUALQUIER número en el texto limpio.
            // Como ya borramos la operación, la hora y la fecha, ¡el único número que queda es el monto!
            const numeros = cleanText.match(/\b[0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?\b/g);
            if (numeros) {
                for (let n of numeros) {
                    let raw = n.toUpperCase().replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1');
                    let val = parseFloat(raw.replace(',', '.'));
                    if (!isNaN(val) && val > 0 && val < 5000) {
                        monto = val;
                        break;
                    }
                }
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
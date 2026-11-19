const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        // 1. Preprocesar imagen (blanco y negro, alto contraste)
        const processedImage = await sharp(fileBuffer)
            .resize(1500, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .toBuffer();

        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        console.log("=== TEXTO LEÍDO POR EL ROBOT ===");
        console.log(text);
        console.log("================================");

        let monto = null;
        let operacion = null;

        // 2. DIVIDIR EL TEXTO EN LÍNEAS (El robot lo analiza línea por línea)
        const lineas = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i];

            // REGLA 1: El Ancla de Yape (Si ve "Yapeaste", el monto está en la siguiente línea o en la misma)
            if (linea.toLowerCase().includes('yapeaste')) {
                // A veces el monto está en la misma línea, a veces en la siguiente
                let posibleMonto = linea.replace(/yapeaste/gi, '').trim();
                if (!posibleMonto && i + 1 < lineas.length) {
                    posibleMonto = lineas[i + 1]; // Lee la siguiente línea
                }
                
                const match = posibleMonto.match(/(\d+(?:[.,]\d{1,2})?)/);
                if (match) {
                    monto = parseFloat(match[1].replace(',', '.'));
                }
            }

            // REGLA 2: Búsqueda directa del formato "S/ 15" o "5/ 15"
            if (monto === null) {
                const matchSoles = linea.match(/[s5$]\s*[\/l]?\s*(\d+(?:[.,]\d{1,2})?)/i);
                if (matchSoles && matchSoles[1]) {
                    let val = parseFloat(matchSoles[1].replace(',', '.'));
                    if (val > 0 && val < 5000) monto = val;
                }
            }

            // REGLA 3: Búsqueda del Número de Operación
            // Evitamos tomar el código de seguridad (que suele ser 3 dígitos separados)
            const matchOp = linea.match(/\b\d{6,9}\b/g);
            if (matchOp) {
                for (let op of matchOp) {
                    let val = parseInt(op);
                    // Ignorar si parece un año (2020-2030)
                    if (val >= 2020 && val <= 2030) continue;
                    operacion = op;
                }
            }
        }

        // REGLA 4: Si todo lo anterior falló, usar el "Modo Pánico" (buscar números seguros)
        if (monto === null) {
            const numeros = text.match(/\b\d{1,4}(?:[.,]\d{1,2})?\b/g);
            if (numeros) {
                for (let num of numeros) {
                    let val = parseFloat(num.replace(',', '.'));
                    if (val >= 2020 && val <= 2030) continue; // Ignorar año
                    if (val > 5000) continue; // Ignorar operación/celular
                    monto = val;
                    break;
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
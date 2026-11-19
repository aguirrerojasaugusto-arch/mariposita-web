const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        const metadata = await sharp(fileBuffer).metadata();
        const worker = await createWorker('spa');

        // ==========================================
        // ⭐ PARTE 1: RECORTE PARA EL MONTO ⭐
        // ==========================================
        // Recortamos desde el 20% hasta el 45% de la altura.
        // Esto captura "¡Yapeaste!" y "S/ 15", pero CORTA la hora y la fecha.
        const topMonto = Math.floor(metadata.height * 0.20);
        const heightMonto = Math.floor(metadata.height * 0.25);

        const imageMonto = await sharp(fileBuffer)
            .extract({ left: 0, top: topMonto, width: metadata.width, height: heightMonto })
            .resize(1500, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .sharpen() // Hace que el "5" resalte y no se vea como "0"
            .toBuffer();

        // Le decimos a Tesseract que SOLO busque números, S y / en esta zona
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789S/s$/,.'
        });

        const { data: { text: textMonto } } = await worker.recognize(imageMonto);

        // Limpiamos errores comunes del OCR
        let cleanMonto = textMonto.replace(/\s+/g, '');
        cleanMonto = cleanMonto.replace(/[s$]/gi, 'S').replace(/[l|]/g, '/');
        
        let monto = null;
        // Buscamos el patrón S/15 o S/15.00
        const matchSoles = cleanMonto.match(/S\/(\d+(?:[.,]\d{1,2})?)/);
        
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        } else {
            // Respaldo: Si no encontró la S, busca cualquier número en este recorte
            const numMatch = cleanMonto.match(/(\d+(?:[.,]\d{1,2})?)/);
            if (numMatch && numMatch[1]) {
                monto = parseFloat(numMatch[1].replace(',', '.'));
            }
        }

        // ==========================================
        // ⭐ PARTE 2: RECORTE PARA LA OPERACIÓN ⭐
        // ==========================================
        // Recortamos la parte de abajo (60% al 95% de la altura)
        const topOp = Math.floor(metadata.height * 0.60);
        const heightOp = Math.floor(metadata.height * 0.35);

        const imageOp = await sharp(fileBuffer)
            .extract({ left: 0, top: topOp, width: metadata.width, height: heightOp })
            .resize(1500, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .toBuffer();

        // Ahora le decimos que SOLO busque números puros (para la operación)
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789'
        });

        const { data: { text: textOp } } = await worker.recognize(imageOp);
        await worker.terminate();

        let operacion = null;
        const opMatches = textOp.match(/\d{6,9}/g);
        if (opMatches && opMatches.length > 0) {
            operacion = opMatches.sort((a, b) => b.length - a.length)[0]; 
        }

        // LOGS DE DEPURACIÓN
        console.log("=== TEXTO MONTO (RECORTE 1) ===");
        console.log(textMonto);
        console.log("Monto detectado:", monto);
        console.log("=== TEXTO OPERACIÓN (RECORTE 2) ===");
        console.log(textOp);
        console.log("Operación detectada:", operacion);

        return {
            monto,
            operacion,
            texto_completo: textMonto + " | " + textOp,
            error_ocr: null
        };

    } catch (e) {
        console.error("Error OCR Local:", e.message);
        return { ...vacio, error_ocr: `Error OCR: ${e.message}` };
    }
}

module.exports = { extraerDatosLocal };
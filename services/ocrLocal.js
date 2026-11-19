const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        const metadata = await sharp(fileBuffer).metadata();
        const worker = await createWorker('spa');

        // ==========================================
        // ⭐ RECORTE QUIRÚRGICO DEL MONTO ⭐
        // ==========================================
        // Recortamos exactamente del 25% al 40% de la imagen.
        // Esto captura el "S/ 15" pero deja fuera la fecha y la hora (que están más abajo).
        const topMonto = Math.floor(metadata.height * 0.25);
        const heightMonto = Math.floor(metadata.height * 0.15);

        const imageMonto = await sharp(fileBuffer)
            .extract({ left: 0, top: topMonto, width: metadata.width, height: heightMonto })
            .resize(1200, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .sharpen() // Resalta los bordes del "15"
            .toBuffer();

        // ⭐ YA NO USAMOS WHITELIST ⭐ 
        // Dejamos que lea normal, para que respete los espacios y no junte todo.
        const { data: { text: textMonto } } = await worker.recognize(imageMonto);

        let monto = null;
        
        // Buscamos el patrón "S/" o "5/" seguido del número
        const matchSoles = textMonto.toLowerCase().match(/[s5]\s*[\/l]\s*(\d+(?:[.,]\d{1,2})?)/);
        
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        } else {
            // Si Tesseract se comió la "S/", buscamos el primer número que aparezca en este recorte
            const matchNum = textMonto.match(/\b\d+(?:[.,]\d{1,2})?\b/);
            if (matchNum) {
                monto = parseFloat(matchNum[0].replace(',', '.'));
            }
        }

        // ==========================================
        // ⭐ RECORTE DE LA OPERACIÓN ⭐
        // ==========================================
        // La operación está en la parte de abajo (75% al 95%)
        const topOp = Math.floor(metadata.height * 0.75);
        const heightOp = Math.floor(metadata.height * 0.20);

        const imageOp = await sharp(fileBuffer)
            .extract({ left: 0, top: topOp, width: metadata.width, height: heightOp })
            .resize(1200, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .toBuffer();

        // Para la operación sí le decimos que busque solo números
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

        // LOGS PARA DEPURAR
        console.log("=== TEXTO MONTO (RECORTE 25%-40%) ===");
        console.log(textMonto);
        console.log("Monto detectado:", monto);
        console.log("=== TEXTO OPERACIÓN (RECORTE 75%-95%) ===");
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
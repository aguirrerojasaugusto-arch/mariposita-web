const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        // 1. PREPROCESAMIENTO MEJORADO
        // Aumentamos la resolución, aplicamos escala de grises y normalizamos el contraste.
        // QUITAMOS el .threshold(180) porque estaba borrando la "S/" en capturas reales.
        const processedImage = await sharp(fileBuffer)
            .resize(2000, null, { withoutEnlargement: true }) 
            .grayscale()
            .normalize() 
            .toBuffer();

        // 2. OCR LOCAL (Tesseract)
        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        // ⭐ LOG DE DEPURACIÓN: Esto te dirá exactamente qué leyó Tesseract
        console.log("=== TEXTO LEÍDO POR TESSERACT ===");
        console.log(text);
        console.log("==================================");

        // 3. EXTRACCIÓN DEL MONTO (Estrategia de triple respaldo)
        let monto = null;
        
        // Respaldo A: Quitamos todos los espacios del texto (ej. "S/ 15" -> "s/15")
        const textoCompacto = text.replace(/\s+/g, '').toLowerCase();
        const matchSoles = textoCompacto.match(/s\/\.?(\d+(?:[.,]\d{1,2})?)/);
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        }

        // Respaldo B: Si falló, buscamos cualquier número con decimales (ej. "15.00" o "15,50")
        if (monto === null) {
            const matchDecimales = text.match(/\b(\d+[.,]\d{2})\b/);
            if (matchDecimales && matchDecimales[1]) {
                monto = parseFloat(matchDecimales[1].replace(',', '.'));
            }
        }

        // Respaldo C: Si es un monto entero (ej. "15") y Tesseract se comió la "S/"
        if (monto === null) {
            // Buscamos números de 1 a 5 dígitos que no sean el número de operación
            const numeros = text.match(/\b\d{1,5}\b/g);
            if (numeros && numeros.length > 0) {
                monto = parseFloat(numeros[0]); // Suele ser el primer número grande arriba
            }
        }

        // 4. EXTRACCIÓN DEL NÚMERO DE OPERACIÓN
        let operacion = null;
        const opMatches = text.match(/\b\d{6,9}\b/g);
        if (opMatches && opMatches.length > 0) {
            operacion = opMatches.sort((a, b) => b.length - a.length)[0]; // Toma el más largo
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
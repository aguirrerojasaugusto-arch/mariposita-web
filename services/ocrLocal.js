const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        // 1. PREPROCESAMIENTO ROBUSTO PARA CAPTURAS DE CELULAR
        // Escala de grises, normalización de contraste y binarización (blanco y negro puro)
        const processedImage = await sharp(fileBuffer)
            .resize(1500, null, { withoutEnlargement: true })
            .grayscale()
            .normalize() 
            .threshold(180) // Convierte a blanco y negro puro para mejor lectura
            .toBuffer();

        // 2. OCR LOCAL (Tesseract)
        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        const textLower = text.toLowerCase();
        let monto = null;
        let operacion = null;

        // 3. EXTRACCIÓN DEL MONTO
        // Busca patrones como "S/ 50.00", "S/50", "50.00"
        const matchSoles = text.match(/(?:s\/\.?|s\/)\s*(\d+(?:[.,]\d{2})?)/i);
        const matchDecimales = text.match(/\b(\d+[.,]\d{2})\b/); // Ej: 50.00
        
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        } else if (matchDecimales && matchDecimales[1]) {
            monto = parseFloat(matchDecimales[1].replace(',', '.'));
        }

        // 4. EXTRACCIÓN DEL NÚMERO DE OPERACIÓN
        // Busca números de 6 a 9 dígitos, priorizando los que estén cerca de la palabra "operación"
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
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

        let monto = null;
        const textLower = text.toLowerCase();

        // 1. Buscar el patrón clásico "S/" o "5/" (por si Tesseract confunde la S con 5)
        // Acepta montos enteros (15) o con decimales (15.00 o 15,50)
        const matchSoles = textLower.match(/[s5]\s*\/\s*(\d+(?:[.,]\d{1,2})?)/);
        if (matchSoles && matchSoles[1]) {
            monto = parseFloat(matchSoles[1].replace(',', '.'));
        }

        // 2. Si falla, buscar justo debajo de la palabra "Yapeaste"
        if (monto === null) {
            const matchYape = textLower.match(/yapeaste[\s\S]{0,30}?(\d+(?:[.,]\d{1,2})?)/);
            if (matchYape && matchYape[1]) {
                monto = parseFloat(matchYape[1].replace(',', '.'));
            }
        }

        // 3. Último respaldo: buscar cualquier número, pero IGNORAR años y horas
        if (monto === null) {
            const numeros = text.match(/\b\d{1,5}(?:[.,]\d{2})?\b/g);
            if (numeros) {
                for (let num of numeros) {
                    const val = parseFloat(num.replace(',', '.'));
                    // Excluir años (2020 a 2030) para que no vuelva a leer la fecha
                    if (val >= 2020 && val <= 2030) continue;
                    monto = val;
                    break;
                }
            }
        }

        // 4. Extracción del Número de Operación
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
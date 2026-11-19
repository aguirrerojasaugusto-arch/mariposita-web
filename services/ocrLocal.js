const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        // 1. Quitamos el fondo morado y resaltamos el texto
        const processedImage = await sharp(fileBuffer)
            .trim() 
            .resize(1500, null, { withoutEnlargement: true })
            .grayscale()
            .normalize()
            .sharpen() // Ayuda a que el 5 se lea como 5 y no como 0
            .toBuffer();

        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        console.log("=== TEXTO LEÍDO (ROBOT) ===");
        console.log(text);
        console.log("===========================");

        let monto = null;
        let operacion = null;

        // ==========================================
        // 2. EL ROBOT DE LIMPIEZA (Destruye horas y fechas)
        // ==========================================
        let cleanText = text;
        // Destruye horas (ej. "10:00 a. m." o "10:00")
        cleanText = cleanText.replace(/\b\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?/gi, '');
        // Destruye fechas (ej. "12 oct. 2026")
        cleanText = cleanText.replace(/\b\d{1,2}\s*(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s*\d{2,4}/gi, '');
        // Destruye el código de seguridad de 3 dígitos separados
        cleanText = cleanText.replace(/\b\d\s\d\s\d\b/g, '');

        const cleanLines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // ==========================================
        // 3. EXTRACCIÓN DEL MONTO (Método Ancla)
        // ==========================================
        for (let i = 0; i < cleanLines.length; i++) {
            const linea = cleanLines[i];
            
            // Si encontramos la palabra "Yapeaste" o "Yape"
            if (linea.toLowerCase().includes('yapeaste') || linea.toLowerCase().includes('yape')) {
                // Revisamos la línea actual
                let match = linea.match(/[s5$]\s*[\/l]?\s*(\d+(?:[.,]\d{1,2})?)/i);
                
                // Si no está ahí, revisamos la SIGUIENTE línea (donde siempre está el monto)
                if (!match && i + 1 < cleanLines.length) {
                    match = cleanLines[i + 1].match(/(\d+(?:[.,]\d{1,2})?)/);
                }

                if (match && match[1]) {
                    let val = parseFloat(match[1].replace(',', '.'));
                    if (val > 0 && val < 5000) {
                        monto = val;
                        break;
                    }
                }
            }

            // Búsqueda general si el ancla falló
            if (monto === null) {
                const matchSoles = linea.match(/[s5$]\s*[\/l]\s*(\d+(?:[.,]\d{1,2})?)/i);
                if (matchSoles && matchSoles[1]) {
                    let val = parseFloat(matchSoles[1].replace(',', '.'));
                    if (val > 0 && val < 5000) monto = val;
                }
            }
        }

        // ==========================================
        // 4. EXTRACCIÓN DE LA OPERACIÓN (Números puros)
        // ==========================================
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
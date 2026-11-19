async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, destinatario: null, celular_destino: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    if (!process.env.OCR_SPACE_API_KEY) {
        return { ...vacio, error_ocr: 'Falta configurar OCR_SPACE_API_KEY en Render' };
    }

    try {
        const formData = new FormData();
        formData.append('apikey', process.env.OCR_SPACE_API_KEY);
        formData.append('language', 'spa');
        formData.append('OCREngine', '2'); // Motor 2: preciso para capturas de celular
        const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
        formData.append('file', blob, 'comprobante.jpg');

        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.IsErroredOnProcessing) {
            console.error("Error OCR.space:", data.ErrorMessage);
            return { ...vacio, error_ocr: 'No se pudo procesar la imagen con OCR.space.' };
        }

        const text = data.ParsedResults[0].ParsedText;
        
        console.log("=== TEXTO LEÍDO POR OCR.SPACE ===");
        console.log(text);
        console.log("==================================");

        let monto = null;
        let operacion = null;
        let destinatario = null;
        let celular_destino = null;

        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // 1. Búsqueda del Monto y del Destinatario (suele estar en la línea de abajo)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matchSoles = line.match(/[s5$]\s*[\/l]\s*(\d+(?:[.,]\d{1,2})?)/i);
            
            if (matchSoles && matchSoles[1]) {
                monto = parseFloat(matchSoles[1].replace(',', '.'));
                // El nombre del destinatario suele estar en la línea inmediatamente inferior
                if (i + 1 < lines.length) {
                    destinatario = lines[i + 1].replace(/\*/g, '').trim(); 
                }
                break;
            }
        }

        // Respaldo para el monto
        if (monto === null) {
            const nums = text.match(/\b\d{1,4}(?:[.,]\d{1,2})?\b/g);
            if (nums) {
                for (let num of nums) {
                    let val = parseFloat(num.replace(',', '.'));
                    if (val >= 2020 && val <= 2030) continue;
                    if (val > 5000) continue;
                    monto = val;
                    break;
                }
            }
        }

        // 2. Búsqueda de los últimos 3 dígitos del celular de destino
        // Busca patrones como: *** *** 715, ***-***-715, ****** 715, etc.
        const matchCel = text.match(/(?:\*+\s*){2,}(\d{3})/);
        if (matchCel) {
            celular_destino = matchCel[1];
        }

        // 3. Búsqueda de la Operación
        const opMatches = text.match(/\b\d{6,9}\b/g);
        if (opMatches && opMatches.length > 0) {
            const validOps = opMatches.filter(op => {
                const v = parseInt(op);
                return !(v >= 2020 && v <= 2030);
            });
            if (validOps.length > 0) {
                operacion = validOps.sort((a, b) => b.length - a.length)[0];
            }
        }

        return { monto, operacion, destinatario, celular_destino, texto_completo: text, error_ocr: null };

    } catch (e) {
        console.error("Error OCR Local:", e.message);
        return { ...vacio, error_ocr: `Error de red: ${e.message}` };
    }
}

module.exports = { extraerDatosLocal };
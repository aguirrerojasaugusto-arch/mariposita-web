async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, destinatario: null, celular_destino: null, fecha_hora: null, texto_completo: null, error_ocr: null };
    
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
        return { ...vacio, error_ocr: 'El archivo no es una imagen válida.' };
    }

    if (!process.env.OCR_SPACE_API_KEY) {
        return { ...vacio, error_ocr: 'Falta configurar OCR_SPACE_API_KEY en Render' };
    }

    try {
        const formData = new FormData();
        formData.append('apikey', process.env.OCR_SPACE_API_KEY);
        formData.append('language', 'spa');
        formData.append('OCREngine', '2'); 
        const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
        formData.append('file', blob, 'comprobante.jpg');

        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            return { ...vacio, error_ocr: `Error de servidor OCR (HTTP ${response.status})` };
        }

        const data = await response.json();

        if (!data) return { ...vacio, error_ocr: 'El OCR devolvió una respuesta vacía.' };
        if (data.IsErroredOnProcessing) return { ...vacio, error_ocr: data.ErrorMessage || 'No se pudo procesar la imagen.' };
        if (!data.ParsedResults || !Array.isArray(data.ParsedResults) || data.ParsedResults.length === 0) {
            return { ...vacio, error_ocr: 'No se pudo leer el texto. Intenta con una captura más clara.' };
        }

        const text = data.ParsedResults[0]?.ParsedText || '';
        
        console.log("=== TEXTO LEÍDO POR OCR.SPACE ===");
        console.log(text);
        console.log("==================================");

        let monto = null;
        let operacion = null;
        let destinatario = null;
        let celular_destino = null;
        let fecha_hora = null;

        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // 1. BUSCAR MONTO (Mejorado para capturar S/ 10, S/10, 5/ 10, etc.)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineLower = line.toLowerCase();

            // Busca formatos como S/ 10, S / 10, 5/ 10
            const matchSoles = line.match(/(?:s\s*\/|s\/|5\s*\/|\$\/|\$|s\s*l)\s*(\d+(?:[.,]\d{1,2})?)/i);
            if (matchSoles && matchSoles[1] && !monto) {
                let val = parseFloat(matchSoles[1].replace(',', '.'));
                if (!isNaN(val)) monto = val; 
                
                if (i + 1 < lines.length) {
                    destinatario = lines[i + 1].replace(/\*/g, '').trim(); 
                }
            }

            if (lineLower.includes('celular') || line.includes('*')) {
                const soloNumeros = line.replace(/\D/g, '');
                if (soloNumeros.length >= 3) {
                    celular_destino = soloNumeros.slice(-3);
                }
            }
        }

        // 2. FALLBACK MONTO (Si no encontró S/, limpia horas y fechas para no agarrar el 12:25)
        if (monto === null) {
            // Quitamos horas (12:25), fechas (09 nov 2026) y años (2026) del texto
            const textLimpio = text
                .replace(/\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, '') 
                .replace(/\b\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/gi, '') 
                .replace(/\b(19|20)\d{2}\b/g, ''); 

            const nums = textLimpio.match(/\b\d{1,4}(?:[.,]\d{1,2})?\b/g);
            if (nums) {
                for (let num of nums) {
                    let val = parseFloat(num.replace(',', '.'));
                    if (isNaN(val)) continue;
                    if (val > 5000) continue; // Ignorar números de operación largos
                    monto = val;
                    break;
                }
            }
        }

        // 3. BUSCAR OPERACIÓN
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

        // 4. EXTRAER FECHA Y HORA
        const monthMap = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12' };
        const fechaMatch = text.match(/(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s+(\d{4})/i);
        const horaMatch = text.match(/(\d{1,2}):(\d{2})\s*([ap]\.?\s*m\.?)/i);

        if (fechaMatch && horaMatch) {
            const dia = fechaMatch[1].padStart(2, '0');
            const mes = monthMap[fechaMatch[2].toLowerCase()];
            const anio = fechaMatch[3];
            
            let hh = parseInt(horaMatch[1], 10);
            const mm = horaMatch[2].padStart(2, '0');
            const ampm = horaMatch[3].toLowerCase().replace(/[\s.]/g, ''); 
            
            if (ampm === 'pm' && hh < 12) hh += 12;
            if (ampm === 'am' && hh === 12) hh = 0;
            const hhStr = String(hh).padStart(2, '0');
            
            fecha_hora = `${anio}-${mes}-${dia}T${hhStr}:${mm}:00-05:00`;
        }

        return { monto, operacion, destinatario, celular_destino, fecha_hora, texto_completo: text, error_ocr: null };

    } catch (e) {
        console.error("Error OCR Local:", e.message);
        return { ...vacio, error_ocr: `Error de red: ${e.message}` };
    }
}

module.exports = { extraerDatosLocal };
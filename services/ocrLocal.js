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

        // LOG DE DEPURACIÓN (Para ver qué lee exactamente la IA)
        console.log("=== TEXTO LEÍDO POR TESSERACT ===");
        console.log(text);
        console.log("==================================");

        let monto = null;
        const textLower = text.toLowerCase();

        // 1. Búsqueda del patrón "S/" o "5/" (con corrección de errores OCR)
        const matchSoles = text.match(/[s5$]\s*[\/l]?\s*([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)/i);
        if (matchSoles && matchSoles[1]) {
            let raw = matchSoles[1].toUpperCase()
                .replace(/S/g, '5') // Corrige si leyó "1S" en vez de "15"
                .replace(/O/g, '0') // Corrige si leyó "O" en vez de "0"
                .replace(/I/g, '1') // Corrige si leyó "I" en vez de "1"
                .replace(/L/g, '1');
            let val = parseFloat(raw.replace(',', '.'));
            if (!isNaN(val) && val > 0) monto = val;
        }

        // 2. Si falla, buscar el número que está justo debajo de "¡Yapeaste!"
        if (monto === null) {
            const yapeIndex = textLower.indexOf('yapeaste');
            if (yapeIndex !== -1) {
                const nextText = text.substring(yapeIndex, yapeIndex + 80);
                const nums = nextText.match(/\b([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)\b/gi);
                if (nums) {
                    for (let n of nums) {
                        let raw = n.toUpperCase().replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1');
                        let val = parseFloat(raw);
                        // Ignorar años (2020-2035)
                        if (!isNaN(val) && val > 0 && val < 5000 && !(val >= 2020 && val <= 2035)) {
                            monto = val;
                            break;
                        }
                    }
                }
            }
        }

        // 3. Último respaldo: analizar las primeras 10 líneas de texto
        if (monto === null) {
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (let i = 0; i < Math.min(lines.length, 10); i++) {
                let line = lines[i];
                // Ignorar líneas que sabemos que no contienen el monto
                if (/fecha|hora|celular|operaci|seguridad|destino/i.test(line)) continue;

                const nums = line.match(/\b([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)\b/gi);
                if (nums) {
                    for (let n of nums) {
                        let raw = n.toUpperCase().replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1');
                        let val = parseFloat(raw);
                        if (!isNaN(val) && val > 0 && val < 5000 && !(val >= 2020 && val <= 2035)) {
                            monto = val;
                            break;
                        }
                    }
                }
                if (monto !== null) break;
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
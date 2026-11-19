const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

async function extraerDatosLocal(fileBuffer) {
    const vacio = { monto: null, operacion: null, texto_completo: null, error_ocr: null };
    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };

    try {
        // ⭐ 1. RECORTE DINÁMICO INTELIGENTE ⭐
        // Obtenemos el tamaño real de la imagen
        const metadata = await sharp(fileBuffer).metadata();
        
        // Recortamos una franja horizontal: 
        // Empezamos a 20% desde arriba (para saltar el logo de Yape)
        // Y tomamos un 40% de altura (donde está el monto y el nombre)
        const cropTop = Math.floor(metadata.height * 0.20);
        const cropHeight = Math.floor(metadata.height * 0.40);

        const processedImage = await sharp(fileBuffer)
            .extract({ left: 0, top: cropTop, width: metadata.width, height: cropHeight })
            .resize(1500, null, { withoutEnlargement: true }) 
            .grayscale()
            .normalize()
            .threshold(150) // Blanco y negro puro para que el texto resalte
            .toBuffer();

        const worker = await createWorker('spa');
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        // Al recortar, el texto leído será mucho más corto y limpio
        console.log("=== TEXTO LEÍDO (RECORTADO) ===");
        console.log(text);
        console.log("================================");

        let monto = null;
        const textLower = text.toLowerCase();

        // 2. BÚSQUEDA DEL MONTO
        // Busca el patrón "S/ 15" o "5/ 15"
        const matchSoles = textLower.match(/[s5$]\s*[\/l]?\s*([0-9oOlIsS]{1,5}(?:[.,][0-9oOlIsS]{1,2})?)/);
        if (matchSoles && matchSoles[1]) {
            let raw = matchSoles[1].toUpperCase()
                .replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1');
            let val = parseFloat(raw.replace(',', '.'));
            if (!isNaN(val) && val > 0) monto = val;
        }

        // Respaldo: Como recortamos la imagen, si solo hay un número en el texto, ¡ese es el monto!
        if (monto === null) {
            const nums = textLower.match(/\b([0-9oOlIsS]{1,5})\b/g);
            if (nums && nums.length > 0) {
                for (let n of nums) {
                    let raw = n.toUpperCase().replace(/S/g, '5').replace(/O/g, '0').replace(/I/g, '1');
                    let val = parseFloat(raw);
                    // Evitar que tome el año (2020-2030)
                    if (!isNaN(val) && val > 0 && val < 5000 && !(val >= 2020 && val <= 2030)) {
                        monto = val;
                        break;
                    }
                }
            }
        }

        // 3. NÚMERO DE OPERACIÓN
        // Lo buscamos en el texto original completo (no en el recortado)
        // Como Tesseract es lento, para la operación usaremos un enfoque rápido.
        let operacion = null;
        // Como recortamos arriba, el número de operación no saldrá en `text`.
        // Hacemos una segunda lectura rápida de la parte de abajo si es necesario,
        // o simplemente extraemos los números del texto completo si lo tuvieramos.
        // PERO, para no hacer 2 lecturas, le pediremos al usuario que el número de operación
        // se extraiga del texto recortado si por casualidad aparece, o usamos un regex en el texto.
        
        // Para mantenerlo simple y rápido, si el texto recortado no tiene la operación, 
        // podemos usar un regex sobre el texto completo original si lo tienes. 
        // Como en este archivo solo tenemos la imagen, haremos un fallback con la imagen completa:
        const fullWorker = await createWorker('spa');
        const { data: { text: fullText } } = await fullWorker.recognize(await sharp(fileBuffer).resize(1000).toBuffer());
        await fullWorker.terminate();

        const opMatches = fullText.match(/\b\d{6,9}\b/g);
        if (opMatches && opMatches.length > 0) {
            // Excluir años
            const validOps = opMatches.filter(op => !(parseInt(op) >= 2020 && parseInt(op) <= 2030));
            if (validOps.length > 0) {
                operacion = validOps.sort((a, b) => b.length - a.length)[0]; 
            }
        }

        return {
            monto,
            operacion,
            texto_completo: fullText,
            error_ocr: null
        };

    } catch (e) {
        console.error("Error OCR Local:", e.message);
        return { ...vacio, error_ocr: `Error OCR: ${e.message}` };
    }
}

module.exports = { extraerDatosLocal };
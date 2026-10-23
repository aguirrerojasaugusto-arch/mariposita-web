const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// Función para esperar
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function extraerDatosComprobante(fileBuffer) {
    const vacio = { monto: null, fecha: null, operacion: null, codigo_seguridad: null, error_ocr: null };

    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };
    if (!process.env.GEMINI_API_KEY) return { ...vacio, error_ocr: 'OCR deshabilitado (falta GEMINI_API_KEY)' };

    try {
        const base64 = fileBuffer.toString('base64');
        
        const prompt = `Analiza esta captura de pantalla de un pago móvil peruano (Yape o Plin).
Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura exacta:
{
  "monto": number | null,
  "fecha": "YYYY-MM-DD HH:mm" | null,
  "operacion": string | null,
  "codigo_seguridad": string | null
}

Instrucciones ESTRICTAS:
1. "monto": Busca el número grande con el monto de la transacción (ej. 15.00, 50). SIN el símbolo "S/".
2. "operacion": Busca el texto "Nro. de operación" (suele tener 6 a 9 dígitos).
3. "codigo_seguridad": Busca el número de 3 dígitos junto a "CÓDIGO DE SEGURIDAD".
4. "fecha": Fecha y hora de la transacción.
Si no puedes leer un dato, pon null. NO inventes datos.`;

        const body = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/jpeg", data: base64 } }
                ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
        };

        let resp;
        let intentos = 0;
        const maxIntentos = 3;

        // Bucle para reintentar si el servidor está saturado (503)
        while (intentos < maxIntentos) {
            resp = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (resp.ok) break; // Si responde bien, salimos

            // Si es error 503 (saturado), esperamos y reintentamos
            if (resp.status === 503) {
                intentos++;
                const espera = 1000 * intentos; // 1s, 2s, 3s...
                console.warn(`⚠️ Gemini saturado. Reintentando en ${espera/1000}s... (Intento ${intentos}/${maxIntentos})`);
                await sleep(espera);
            } else {
                break; // Si es otro error (400, 403, etc.), no reintentamos
            }
        }

        if (!resp.ok) {
            const errorText = await resp.text();
            console.error("Error de API Gemini:", resp.status, errorText);
            return { ...vacio, error_ocr: `Error de API (${resp.status})` };
        }

        const json = await resp.json();
        
        let texto = '';
        if (json.candidates && json.candidates.length > 0) {
            const parts = json.candidates[0].content.parts;
            if (parts && parts.length > 0) {
                texto = parts[0].text || '';
            }
        }
        
        const limpio = texto.replace(/```json|```/g, '').trim();
        const match = limpio.match(/\{[\s\S]*\}/);
        
        if (!match) return { ...vacio, error_ocr: 'No se pudo interpretar la respuesta de la IA.' };

        const datos = JSON.parse(match[0]);
        
        let opLimpia = datos.operacion ? String(datos.operacion).replace(/[^0-9]/g, '') : null;
        let codLimpio = datos.codigo_seguridad ? String(datos.codigo_seguridad).replace(/[^0-9]/g, '') : null;

        return {
            monto: typeof datos.monto === 'number' ? datos.monto : null,
            fecha: datos.fecha || null,
            operacion: opLimpia || null,
            codigo_seguridad: codLimpio || null,
            error_ocr: null
        };
    } catch (e) {
        console.error("Error OCR:", e.message);
        return { ...vacio, error_ocr: `Error de red: ${e.message}` };
    }
}

module.exports = { extraerDatosComprobante };
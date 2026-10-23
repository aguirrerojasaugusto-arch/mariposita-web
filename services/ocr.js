const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function extraerDatosComprobante(fileBuffer) {
    const vacio = { monto: null, fecha: null, operacion: null, destinatario: null, texto_completo: null, error_ocr: null };

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
  "destinatario": string | null,
  "texto_completo": string | null
}

Instrucciones ESTRICTAS:
1. "monto": Busca el número grande con el monto de la transacción (ej. 15.00, 50). SIN el símbolo "S/".
2. "operacion": Busca el texto "Nro. de operación" (suele tener 6 a 9 dígitos).
3. "destinatario": Busca el nombre de la persona a quien se le depositó (suele estar debajo del monto o junto a "Destino Yape", "Para:", "Nombre:", etc). Devuélvelo tal cual está escrito. Si no lo encuentras claramente, pon null.
4. "texto_completo": Copia TODO el texto que puedas leer en la imagen (números, nombres, etc.) para tener un respaldo.
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

        while (intentos < maxIntentos) {
            resp = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (resp.ok) break;
            if (resp.status === 503) {
                intentos++;
                const espera = 1000 * intentos;
                console.warn(`⚠️ Gemini saturado. Reintentando en ${espera/1000}s...`);
                await sleep(espera);
            } else {
                break;
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

        return {
            monto: typeof datos.monto === 'number' ? datos.monto : null,
            fecha: datos.fecha || null,
            operacion: opLimpia || null,
            destinatario: datos.destinatario ? String(datos.destinatario).trim() : null,
            texto_completo: datos.texto_completo ? String(datos.texto_completo).trim() : null,
            error_ocr: null
        };
    } catch (e) {
        console.error("Error OCR:", e.message);
        return { ...vacio, error_ocr: `Error de red: ${e.message}` };
    }
}

module.exports = { extraerDatosComprobante };
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function extraerDatosOrden(fileBuffer) {
    const vacio = { destinatario: null, texto_completo: null, error_ocr: null };

    if (!fileBuffer) return { ...vacio, error_ocr: 'Sin archivo' };
    if (!process.env.GEMINI_API_KEY) return { ...vacio, error_ocr: 'OCR deshabilitado (falta GEMINI_API_KEY)' };

    try {
        const base64 = fileBuffer.toString('base64');
        const prompt = `Analiza esta captura de pantalla de un pago móvil peruano (Yape o Plin).
Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura exacta:
{
  "destinatario": string | null,
  "texto_completo": string | null
}

Instrucciones ESTRICTAS:
1. "destinatario": Busca el nombre de la persona a quien se le depositó (suele estar debajo del monto o junto a "Destino Yape", "Para:", "Nombre:", etc). Devuélvelo tal cual está escrito. Si no lo encuentras claramente, pon null.
2. "texto_completo": Copia TODO el texto que puedas leer en la imagen (números, nombres, etc.) para tener un respaldo.
Si no puedes leer algo, pon null. NO inventes datos.`;

        const body = {
            model: "gemini-3.8-flash",
            input: [
                { type: "text", text: prompt },
                { type: "image", data: base64, mime_type: "image/jpeg" }
            ],
            generation_config: { temperature: 0.1, max_output_tokens: 512 }
        };

        let resp;
        let intentos = 0;
        const maxIntentos = 2;

        while (intentos < maxIntentos) {
            resp = await fetch(GEMINI_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-goog-api-key': process.env.GEMINI_API_KEY 
                },
                body: JSON.stringify(body)
            });

            if (resp.ok) break;
            if (resp.status === 503) {
                intentos++;
                const espera = 2000 * intentos;
                console.warn(`⚠️ Gemini saturado (OCR Ordenes). Reintentando en ${espera/1000}s...`);
                await sleep(espera);
            } else {
                break;
            }
        }

        if (!resp.ok) {
            const errorText = await resp.text();
            console.error("Error de API Gemini (Ordenes):", resp.status, errorText);
            return { ...vacio, error_ocr: `Error de API (${resp.status})` };
        }

        const json = await resp.json();
        
        let texto = '';
        if (json.steps && json.steps.length > 0) {
            const lastStep = json.steps[json.steps.length - 1];
            if (lastStep.content && lastStep.content.length > 0) {
                texto = lastStep.content[0].text || '';
            }
        } else if (json.outputs && json.outputs.length > 0) {
            texto = json.outputs[json.outputs.length - 1].text || '';
        }
        
        const limpio = texto.replace(/```json|```/g, '').trim();
        const match = limpio.match(/\{[\s\S]*\}/);
        
        if (!match) return { ...vacio, error_ocr: 'No se pudo interpretar la respuesta de la IA.' };

        const datos = JSON.parse(match[0]);

        return {
            destinatario: datos.destinatario ? String(datos.destinatario).trim() : null,
            texto_completo: datos.texto_completo ? String(datos.texto_completo).trim() : null,
            error_ocr: null
        };
    } catch (e) {
        console.error("Error OCR Ordenes:", e.message);
        return { ...vacio, error_ocr: `Error de red: ${e.message}` };
    }
}

module.exports = { extraerDatosOrden };
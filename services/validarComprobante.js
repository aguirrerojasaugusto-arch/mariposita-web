const sharp = require('sharp');

async function esComprobanteYape(fileBuffer) {
    try {
        if (!fileBuffer || fileBuffer.length < 10) {
            return { valido: false, error: 'El archivo está vacío o dañado.' };
        }

        // 1. Analizar los metadatos para ver la orientación (debe ser vertical)
        const metadata = await sharp(fileBuffer).metadata();
        if (metadata.width > metadata.height) {
            return { valido: false, error: 'La imagen debe ser una captura de pantalla vertical de tu celular.' };
        }

        // 2. Redimensionar a 100x100 para analizar los colores (súper ligero)
        const { data, info } = await sharp(fileBuffer)
            .resize(100, 100, { fit: 'inside' })
            .raw()
            .toBuffer({ resolveWithObject: true });

        const channels = info.channels;
        let pixelesBlancos = 0;
        let pixelesMorados = 0;
        let totalMuestras = 0;

        for (let i = 0; i < data.length; i += channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Blanco (fondo de la tarjeta de Yape)
            if (r > 220 && g > 220 && b > 220) {
                pixelesBlancos++;
            }
            // Morado (encabezado de Yape / Plin: aprox #5D2E8D a #8B4CB0)
            else if (r > 60 && r < 150 && g < 80 && b > 90 && b < 200) {
                pixelesMorados++;
            }
            totalMuestras++;
        }

        const porcentajeBlanco = (pixelesBlancos / totalMuestras) * 100;
        const porcentajeMorado = (pixelesMorados / totalMuestras) * 100;

        // Reglas: Al menos 30% de fondo blanco y algo de morado (el logo)
        if (porcentajeBlanco < 30) {
            return { valido: false, error: 'La imagen no parece un comprobante de Yape/Plin (falta el fondo blanco de la tarjeta).' };
        }
        
        if (porcentajeMorado < 1) {
            return { valido: false, error: 'La imagen no parece un comprobante de Yape/Plin (no se detectó el color de la marca).' };
        }

        return { valido: true };

    } catch (error) {
        // Si la imagen está corrupta o no se puede leer, la rechazamos
        return { valido: false, error: 'El archivo subido no es una imagen válida o está dañado.' };
    }
}

module.exports = { esComprobanteYape };
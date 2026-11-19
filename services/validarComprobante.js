const sharp = require('sharp');

async function esComprobanteYape(fileBuffer) {
    try {
        if (!fileBuffer || fileBuffer.length < 10) {
            return { valido: false, error: 'El archivo está vacío o dañado.' };
        }

        const metadata = await sharp(fileBuffer).metadata();
        if (metadata.width > metadata.height) {
            return { valido: false, error: 'La imagen debe ser una captura de pantalla vertical de tu celular.' };
        }

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

            // Blanco (fondo de la tarjeta)
            if (r > 200 && g > 200 && b > 200) {
                pixelesBlancos++;
            }
            // Morado (Yape / Plin - Rango ampliado para mayor tolerancia)
            else if (r > 50 && r < 160 && g < 100 && b > 80 && b < 220) {
                pixelesMorados++;
            }
            totalMuestras++;
        }

        const porcentajeBlanco = (pixelesBlancos / totalMuestras) * 100;
        const porcentajeMorado = (pixelesMorados / totalMuestras) * 100;

        if (porcentajeBlanco < 25) {
            return { valido: false, error: 'La imagen no parece un comprobante de Yape/Plin (falta el fondo blanco).' };
        }
        
        // Redujimos el morado a 0.5% porque a veces el logo es pequeño
        if (porcentajeMorado < 0.5) {
            return { valido: false, error: 'La imagen no parece un comprobante de Yape/Plin (no se detectó el color de la marca).' };
        }

        return { valido: true };

    } catch (error) {
        return { valido: false, error: 'El archivo subido no es una imagen válida o está dañado.' };
    }
}

module.exports = { esComprobanteYape };
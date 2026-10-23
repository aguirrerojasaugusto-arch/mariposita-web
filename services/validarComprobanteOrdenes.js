const sharp = require('sharp');

async function validarImagenOrden(fileBuffer) {
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
        let totalMuestras = 0;

        for (let i = 0; i < data.length; i += channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r > 200 && g > 200 && b > 200) {
                pixelesBlancos++;
            }
            totalMuestras++;
        }

        const porcentajeBlanco = (pixelesBlancos / totalMuestras) * 100;
        if (porcentajeBlanco < 20) {
            return { valido: false, error: 'La imagen no parece un comprobante de Yape/Plin (falta el fondo blanco de la tarjeta).' };
        }
        return { valido: true };
    } catch (error) {
        return { valido: false, error: 'El archivo subido no es una imagen válida o está dañado.' };
    }
}

module.exports = { validarImagenOrden };
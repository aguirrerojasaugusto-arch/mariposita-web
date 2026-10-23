const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const router = express.Router();

// Función auxiliar para limpiar textos (quita asteriscos, puntos, etc.)
function limpiarTexto(texto) {
    if (!texto) return '';
    return texto.toLowerCase()
        .replace(/[^a-z0-9áéíóúñ\s]/g, '') // Deja letras, números y espacios
        .replace(/\s+/g, ' ')          // Reemplaza múltiples espacios por uno solo
        .trim();
}

router.post('/tickets', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

        try {
            // 1. Validación visual básica (Colores y orientación)
            const validacion = await esComprobanteYape(req.file.buffer);
            if (!validacion.valido) return res.status(400).json({ error: validacion.error });

            const { sorteo_id, nombre, telefono, dni, departamento, cantidad } = req.body;
            
            if (!sorteo_id || !nombre || !telefono) {
                return res.status(400).json({ error: 'Faltan datos personales (Nombre o Teléfono)' });
            }

            const sorteoRes = await db.execute({
                sql: "SELECT * FROM sorteos WHERE id = ? AND estado = 'activo'",
                args: [sorteo_id]
            });
            const sorteo = sorteoRes.rows[0];
            if (!sorteo) return res.status(400).json({ error: 'Sorteo no disponible' });

            const fechaSorteo = new Date(`${sorteo.fecha_sorteo}T23:59:59`);
            if (new Date() > fechaSorteo) return res.status(400).json({ error: '⚠️ Este sorteo ya ha finalizado.' });

            // ⭐ 2. PROCESAR IMAGEN CON TESSERACT (OCR LOCAL) ⭐
            console.log("⏳ Iniciando lectura de imagen (Tesseract Local)...");
            let textoImagen = "";
            try {
                const processedImage = await sharp(req.file.buffer)
                    .resize(1200, null, { withoutEnlargement: true })
                    .grayscale()
                    .threshold(180)
                    .toBuffer();

                const worker = await createWorker('spa');
                const { data: { text } } = await worker.recognize(processedImage);
                await worker.terminate();

                textoImagen = text;
                console.log("✅ Texto detectado en la imagen.");
            } catch (ocrError) {
                console.error("Error crítico en OCR Local:", ocrError);
                return res.status(400).json({ error: 'No se pudo procesar la imagen. Asegúrate de subir una captura clara y recortada de Yape o Plin.' });
            }

            const textoLimpio = limpiarTexto(textoImagen);
            const cantTickets = parseInt(cantidad) || 1;
            const montoEsperado = sorteo.precio_ticket * cantTickets;

            // ⭐ 3. VALIDACIÓN DE DESTINO (ÚLTIMOS 3 DÍGITOS DEL TELÉFONO) ⭐
            const configYapeRes = await db.execute("SELECT valor FROM configuracion WHERE clave = 'numero_yape'");
            const numeroYapeConfig = configYapeRes.rows[0] ? configYapeRes.rows[0].valor : '';

            if (numeroYapeConfig) {
                const soloNumeros = numeroYapeConfig.replace(/\D/g, '');
                const ultimos3Digitos = soloNumeros.slice(-3);

                if (!textoLimpio.includes(ultimos3Digitos)) {
                    return res.status(400).json({ 
                        error: `El comprobante no parece haber sido enviado a la cuenta correcta. Asegúrate de yapear al número configurado.` 
                    });
                }
            }

            // ⭐ 4. VALIDACIÓN DE MONTO ⭐
            // Buscamos números con o sin decimales que coincidan con el monto esperado
            const montoStr = montoEsperado.toString();
            const montoConCeros = montoEsperado.toFixed(2).replace('.', '');
            
            // Reemplazamos comas por puntos por si la IA lee "35,00"
            const textoMontoLimpio = textoLimpio.replace(/,/g, '.');
            
            const montoEncontrado = textoMontoLimpio.includes(montoStr) || textoMontoLimpio.includes(montoConCeros);

            if (!montoEncontrado) {
                return res.status(400).json({ 
                    error: `El monto del comprobante no coincide con el total a pagar (S/ ${montoEsperado.toFixed(2)}). Verifica la imagen.` 
                });
            }

            // ⭐ 5. VALIDACIÓN DE FECHA (QUE SEA DEL DÍA DE HOY) ⭐
            const hoy = new Date();
            const diaHoy = hoy.getDate().toString();
            const añoHoy = hoy.getFullYear().toString();
            
            // Verificamos si el texto contiene el día de hoy y el año
            if (!textoLimpio.includes(diaHoy) || !textoLimpio.includes(añoHoy)) {
                return res.status(400).json({ 
                    error: `La fecha del comprobante no parece ser de hoy. Asegúrate de subir el comprobante del pago reciente.` 
                });
            }

            // ⭐ 6. VALIDACIÓN DE NÚMERO DE OPERACIÓN ÚNICO ⭐
            const matchOperacion = textoImagen.match(/\b\d{6,9}\b/g);
            let operacionDetectada = null;

            if (matchOperacion && matchOperacion.length > 0) {
                operacionDetectada = matchOperacion.sort((a, b) => b.length - a.length)[0];

                const opTicket = await db.execute({ sql: 'SELECT id FROM tickets WHERE ocr_operacion = ?', args: [operacionDetectada] });
                const opOrden = await db.execute({ sql: 'SELECT id FROM ordenes WHERE ocr_operacion = ?', args: [operacionDetectada] });
                
                if (opTicket.rows.length > 0 || opOrden.rows.length > 0) {
                    return res.status(400).json({ error: '⚠️ Este número de operación ya fue registrado en otra compra.' });
                }
            } else {
                return res.status(400).json({ 
                    error: 'No se pudo leer el Número de Operación en la imagen. Asegúrate de que la captura sea clara.' 
                });
            }

            // 7. VALIDACIÓN DE COMPROBANTE ÚNICO (HASH DE IMAGEN)
            const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante = ?', args: [hash] });
            const ordenDup = await db.execute({ sql: 'SELECT id FROM ordenes WHERE hash_comprobante = ?', args: [hash] });
            
            if (ticketDup.rows.length > 0 || ordenDup.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Esta imagen de comprobante ya fue utilizada en otra compra.' });
            }

            // 8. Guardar el ticket
            const countRes = await db.execute({ sql: 'SELECT COUNT(*) as c FROM tickets WHERE sorteo_id = ?', args: [sorteo_id] });
            const count = countRes.rows[0].c + 1;
            const numero = `S${sorteo.id}-${String(count).padStart(5, '0')}`;
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

            await db.execute({
                sql: `INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, ocr_monto, ocr_operacion)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
                args: [sorteo_id, numero, nombre, dni || null, telefono || null, departamento || null, cantTickets, base64Image, hash, montoEsperado, operacionDetectada]
            });

            res.json({ 
                success: true, 
                numero_ticket: numero, 
                nombre_cliente: nombre,
                departamento: departamento || 'No especificado',
                sorteo_nombre: sorteo.nombre,
                fecha_sorteo: sorteo.fecha_sorteo,
                cantidad: cantTickets,
                mensaje: 'Ticket reservado.' 
            });

        } catch (e) {
            console.error("Error al crear ticket:", e);
            res.status(500).json({ error: 'Error interno al guardar el ticket.' });
        }
    });
});

module.exports = router;
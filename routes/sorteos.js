const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const router = express.Router();

// Función auxiliar para limpiar textos
function limpiarTexto(texto) {
    if (!texto) return '';
    return texto.toLowerCase()
        .replace(/[^a-z0-9áéíóúñ\s]/g, '') 
        .replace(/\s+/g, ' ')          
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

            // 2. PROCESAR IMAGEN CON TESSERACT (OCR LOCAL)
            console.log("⏳ Iniciando lectura de imagen (Tesseract Local)...");
            let textoImagen = "";
            try {
                const processedImage = await sharp(req.file.buffer)
                    .resize(1200, null, { withoutEnlargement: true })
                    .grayscale()
                    .toBuffer();

                const worker = await createWorker('spa');
                const { data: { text } } = await worker.recognize(processedImage);
                await worker.terminate();

                textoImagen = text;
                console.log("Texto detectado:", textoImagen); 
            } catch (ocrError) {
                console.error("Error crítico en OCR Local:", ocrError);
                return res.status(400).json({ error: 'No se pudo procesar la imagen. Asegúrate de subir una captura clara.' });
            }

            const textoLimpio = limpiarTexto(textoImagen);
            const cantTickets = parseInt(cantidad) || 1;
            const montoEsperado = sorteo.precio_ticket * cantTickets;

            // ⭐ 3. VALIDACIÓN ESTRICTA DEL MONTO ⭐
            // Limpiamos el texto para dejar solo números y puntos (ej: "S/ 35.00" -> "35.00")
            const soloNumerosTexto = textoImagen.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
            
            const montoStr = montoEsperado.toFixed(2); // "35.00"
            const montoSinPunto = montoStr.replace('.', ''); // "3500"
            const montoEntero = Math.floor(montoEsperado).toString(); // "35"

            // Verificamos si el monto esperado está en el texto
            const montoEncontrado = soloNumerosTexto.includes(montoStr) || 
                                    soloNumerosTexto.includes(montoSinPunto) || 
                                    soloNumerosTexto.includes(montoEntero);

            if (!montoEncontrado) {
                return res.status(400).json({ 
                    error: `El monto del comprobante no coincide con el total a pagar (S/ ${montoEsperado.toFixed(2)}). Verifica que hayas pagado el monto exacto.` 
                });
            }

            // ⭐ 4. VALIDACIÓN DE NÚMERO DE OPERACIÓN ÚNICO (OBLIGATORIA) ⭐
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
                    error: 'La imagen no parece ser un comprobante válido (no se encontró número de operación).' 
                });
            }

            // ⭐ 5. VALIDACIÓN DE COMPROBANTE ÚNICO (HASH DE IMAGEN) ⭐
            const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante = ?', args: [hash] });
            const ordenDup = await db.execute({ sql: 'SELECT id FROM ordenes WHERE hash_comprobante = ?', args: [hash] });
            
            if (ticketDup.rows.length > 0 || ordenDup.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Esta imagen de comprobante ya fue utilizada en otra compra.' });
            }

            // 6. Guardar el ticket
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
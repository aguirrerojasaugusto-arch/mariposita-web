const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const router = express.Router();

function limpiarTexto(texto) {
    if (!texto) return '';
    return texto.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/g, '').replace(/\s+/g, ' ').trim();
}

router.post('/tickets', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

        try {
            const validacion = await esComprobanteYape(req.file.buffer);
            if (!validacion.valido) return res.status(400).json({ error: validacion.error });

            const { sorteo_id, nombre, telefono, dni, departamento, cantidad } = req.body;
            if (!sorteo_id || !nombre || !telefono) return res.status(400).json({ error: 'Faltan datos' });

            const sorteoRes = await db.execute({ sql: "SELECT * FROM sorteos WHERE id = ? AND estado = 'activo'", args: [sorteo_id] });
            const sorteo = sorteoRes.rows[0];
            if (!sorteo) return res.status(400).json({ error: 'Sorteo no disponible' });

            const fechaSorteo = new Date(`${sorteo.fecha_sorteo}T23:59:59`);
            if (new Date() > fechaSorteo) return res.status(400).json({ error: '⚠️ Este sorteo ya ha finalizado.' });

            // OCR LOCAL
            console.log("⏳ Iniciando lectura de imagen...");
            let textoImagen = "";
            try {
                const processedImage = await sharp(req.file.buffer)
                    .resize(1500, null, { withoutEnlargement: true })
                    .grayscale()
                    .toBuffer();

                const worker = await createWorker('spa');
                const { data: { text } } = await worker.recognize(processedImage);
                await worker.terminate();
                textoImagen = text;
            } catch (ocrError) {
                return res.status(400).json({ error: 'No se pudo procesar la imagen. Asegúrate de subir una captura clara.' });
            }

            const textoLimpio = limpiarTexto(textoImagen);
            const cantTickets = parseInt(cantidad) || 1;
            const montoEsperado = sorteo.precio_ticket * cantTickets;

            // ⭐ VALIDACIÓN DE MONTO CON TOLERANCIA ⭐
            const soloNumeros = textoImagen.replace(/[^0-9.]/g, ''); // Deja solo números y puntos
            const montoEntero = Math.floor(montoEsperado).toString(); // "35"
            const montoConDecimales = montoEsperado.toFixed(2); // "35.00"

            let alertaMonto = false;

            // Si no encuentra ni el entero ni el decimal, es una alerta.
            if (!soloNumeros.includes(montoEntero) && !soloNumeros.includes(montoConDecimales)) {
                alertaMonto = true; 
            }

            // ⭐ VALIDACIÓN DE OPERACIÓN ÚNICA (OBLIGATORIA) ⭐
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
                return res.status(400).json({ error: 'No se encontró el número de operación. Sube una imagen más clara.' });
            }

            // VALIDACIÓN DE COMPROBANTE ÚNICO
            const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante = ?', args: [hash] });
            const ordenDup = await db.execute({ sql: 'SELECT id FROM ordenes WHERE hash_comprobante = ?', args: [hash] });
            if (ticketDup.rows.length > 0 || ordenDup.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Esta imagen ya fue utilizada.' });
            }

            // GUARDAR CON NOTAS DE ALERTA
            const countRes = await db.execute({ sql: 'SELECT COUNT(*) as c FROM tickets WHERE sorteo_id = ?', args: [sorteo_id] });
            const count = countRes.rows[0].c + 1;
            const numero = `S${sorteo.id}-${String(count).padStart(5, '0')}`;
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

            let notasAlerta = [];
            if (alertaMonto) notasAlerta.push(`⚠️ Monto no detectado automáticamente (Esperado: S/ ${montoEsperado.toFixed(2)})`);
            const notaFinal = notasAlerta.length > 0 ? notasAlerta.join(" | ") : null;

            await db.execute({
                sql: `INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, ocr_monto, ocr_operacion, notas_admin)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
                args: [sorteo_id, numero, nombre, dni || null, telefono || null, departamento || null, cantTickets, base64Image, hash, montoEsperado, operacionDetectada, notaFinal]
            });

            res.json({ success: true, numero_ticket: numero, nombre_cliente: nombre, sorteo_nombre: sorteo.nombre, cantidad: cantTickets });
        } catch (e) {
            console.error("Error:", e);
            res.status(500).json({ error: 'Error interno al guardar.' });
        }
    });
});

module.exports = router;
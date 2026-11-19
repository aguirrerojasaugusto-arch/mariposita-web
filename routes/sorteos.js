const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const { extraerDatosLocal } = require('../services/ocrLocal'); // Usamos el nuevo OCR
const router = express.Router();

function generarCodigoTicket() {
    const numero = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
    return String(numero);
}

router.post('/tickets', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

        try {
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

            const fechaSorteo = new Date(`${sorteo.fecha_sorteo}T${sorteo.hora_sorteo || '23:59'}:00-05:00`);
            if (new Date() > fechaSorteo) return res.status(400).json({ error: '⚠️ Este sorteo ya ha finalizado.' });

            // ⭐ EXTRAER DATOS CON OCR LOCAL ROBUSTO ⭐
            const ocr = await extraerDatosLocal(req.file.buffer);
            if (ocr.error_ocr) return res.status(400).json({ error: `No se pudo leer el comprobante: ${ocr.error_ocr}` });

            // ⭐ VALIDACIÓN ESTRICTA DE MONTO ⭐
            const cantTickets = parseInt(cantidad) || 1;
            const montoEsperado = sorteo.precio_ticket * cantTickets;
            
            if (!ocr.monto) {
                return res.status(400).json({ error: 'No se pudo detectar el monto en el comprobante. Asegúrate de que sea legible.' });
            }

            // Tolerancia de 0.10 céntimos por posibles redondeos
            if (Math.abs(ocr.monto - montoEsperado) > 0.10) {
                return res.status(400).json({ 
                    error: `El monto del comprobante (S/ ${ocr.monto.toFixed(2)}) no coincide con el total a pagar (S/ ${montoEsperado.toFixed(2)}).` 
                });
            }

            // Validar Número de Operación
            if (!ocr.operacion) {
                return res.status(400).json({ error: 'No se encontró el número de operación en el comprobante. Asegúrate de que sea legible.' });
            }

            const opTicket = await db.execute({ sql: 'SELECT id FROM tickets WHERE ocr_operacion = ?', args: [ocr.operacion] });
            const opOrden = await db.execute({ sql: 'SELECT id FROM ordenes WHERE ocr_operacion = ?', args: [ocr.operacion] });
            if (opTicket.rows.length > 0 || opOrden.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Este número de operación ya fue registrado en otra compra.' });
            }

            // Validar Hash de Imagen Duplicada
            const hashBase = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante LIKE ?', args: [`${hashBase}%`] });
            if (ticketDup.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Esta imagen ya fue utilizada.' });
            }

            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const codigosGenerados = [];
            const ahoraPeru = "datetime('now', '-05:00')";

            for (let i = 0; i < cantTickets; i++) {
                let numero;
                let isUnique = false;
                while (!isUnique) {
                    numero = generarCodigoTicket();
                    const check = await db.execute({ sql: 'SELECT id FROM tickets WHERE numero_ticket = ?', args: [numero] });
                    if (check.rows.length === 0) isUnique = true;
                }
                codigosGenerados.push(numero);
                const hashUnico = `${hashBase}-${numero}`;

                await db.execute({
                    sql: `INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, ocr_operacion, ocr_monto, creado_en)
                          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pendiente', ?, ?, ${ahoraPeru})`,
                    args: [
                        sorteo_id, numero, nombre.toUpperCase(), 
                        dni ? String(dni).trim() : '', 
                        telefono ? String(telefono).trim() : '', 
                        departamento ? departamento.toUpperCase() : null, 
                        base64Image, hashUnico, ocr.operacion, ocr.monto
                    ]
                });
            }

            res.json({ 
                success: true, 
                codigos: codigosGenerados,
                numero_ticket: codigosGenerados[0],
                mensaje: `Se generaron ${cantTickets} tickets correctamente.` 
            });

        } catch (e) {
            console.error("Error al crear ticket:", e);
            res.status(500).json({ error: 'Error interno: ' + e.message });
        }
    });
});

module.exports = router;
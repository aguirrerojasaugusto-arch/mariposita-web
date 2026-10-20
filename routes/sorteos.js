const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const { extraerDatosComprobante } = require('../services/ocr');
const router = express.Router();

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

            const sorteo = db.prepare("SELECT * FROM sorteos WHERE id = ? AND estado = 'activo'").get(sorteo_id);
            if (!sorteo) return res.status(400).json({ error: 'Sorteo no disponible' });

            const fechaSorteo = new Date(`${sorteo.fecha_sorteo}T23:59:59`);
            if (new Date() > fechaSorteo) return res.status(400).json({ error: '⚠️ Este sorteo ya ha finalizado.' });

            const ocr = await extraerDatosComprobante(req.file.buffer);
            
            if (ocr.error_ocr) {
                console.warn("OCR falló, requiere revisión manual:", ocr.error_ocr);
            } else {
                if (ocr.monto !== null) {
                    const cantTickets = parseInt(cantidad) || 1;
                    const totalEsperado = sorteo.precio_ticket * cantTickets;

                    if (Math.abs(totalEsperado - ocr.monto) > 0.01) {
                        return res.status(400).json({ 
                            error: `El monto del comprobante (S/ ${ocr.monto.toFixed(2)}) no coincide con el total a pagar (S/ ${totalEsperado.toFixed(2)}).` 
                        });
                    }
                }
                // VALIDACIÓN DE TIEMPO DESHABILITADA PARA PRUEBAS
            }

            if (ocr.operacion) {
                const opDuplicadaTicket = db.prepare('SELECT id FROM tickets WHERE ocr_operacion = ?').get(ocr.operacion);
                const duplicadoOrden = db.prepare('SELECT id FROM ordenes WHERE ocr_operacion = ?').get(ocr.operacion);
                if (opDuplicadaTicket || duplicadoOrden) {
                    return res.status(400).json({ error: '⚠️ Este número de operación ya fue registrado en otra compra.' });
                }
            }

            const cantTickets = parseInt(cantidad) || 1;
            const count = db.prepare('SELECT COUNT(*) as c FROM tickets WHERE sorteo_id = ?').get(sorteo_id).c + 1;
            const numero = `S${sorteo.id}-${String(count).padStart(5, '0')}`;
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

            db.prepare(`
                INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, ocr_monto, ocr_operacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
            `).run(sorteo_id, numero, nombre, dni || null, telefono || null, departamento || null, cantTickets, base64Image, hash, ocr.monto, ocr.operacion);

            // ⭐ AQUÍ ENVIAMOS TODOS LOS DATOS AL FRONTEND
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
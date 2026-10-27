const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');

// ⭐ IMPORTAMOS LA FUNCIÓN DEL OCR DE GEMINI ⭐
const { extraerDatosComprobante } = require('../services/ocr');

const router = express.Router();

// ⭐ FUNCIÓN PARA GENERAR CÓDIGO ALEATORIO ⭐
function generarCodigoTicket() {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let resultado = '';
    for (let i = 0; i < 6; i++) {
        resultado += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return `TKT-${resultado}`;
}

router.post('/tickets', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

        try {
            // 1. VALIDAR IMAGEN CON SHARP
            const validacion = await esComprobanteYape(req.file.buffer);
            if (!validacion.valido) return res.status(400).json({ error: validacion.error });

            const { sorteo_id, nombre, telefono, dni, departamento, cantidad } = req.body;
            
            if (!sorteo_id || !nombre || !telefono) {
                return res.status(400).json({ error: 'Faltan datos personales (Nombre o Teléfono)' });
            }

            // 2. VALIDAR SORTEO Y FECHA (CON ZONA HORARIA DE PERÚ)
            const sorteoRes = await db.execute({
                sql: "SELECT * FROM sorteos WHERE id = ? AND estado = 'activo'",
                args: [sorteo_id]
            });
            const sorteo = sorteoRes.rows[0];
            if (!sorteo) return res.status(400).json({ error: 'Sorteo no disponible' });

            const fechaSorteo = new Date(`${sorteo.fecha_sorteo}T${sorteo.hora_sorteo || '23:59'}:00-05:00`);
            if (new Date() > fechaSorteo) return res.status(400).json({ error: '⚠️ Este sorteo ya ha finalizado.' });

            // 3. PROCESAR OCR CON GEMINI
            const ocr = await extraerDatosComprobante(req.file.buffer);
            if (ocr.error_ocr) {
                return res.status(400).json({ error: 'No se pudo leer el comprobante: ' + ocr.error_ocr });
            }

            // 4. VALIDAR NÚMERO DE OPERACIÓN
            let operacionDetectada = ocr.operacion;
            if (!operacionDetectada) {
                return res.status(400).json({ error: 'No se encontró el número de operación en el comprobante.' });
            }
            
            const opTicket = await db.execute({ sql: 'SELECT id FROM tickets WHERE ocr_operacion = ?', args: [operacionDetectada] });
            const opOrden = await db.execute({ sql: 'SELECT id FROM ordenes WHERE ocr_operacion = ?', args: [operacionDetectada] });
            if (opTicket.rows.length > 0 || opOrden.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Este número de operación ya fue registrado en otra compra.' });
            }

            // 5. VALIDAR IMAGEN DUPLICADA
            const hashBase = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante LIKE ?', args: [`${hashBase}%`] });
            
            if (ticketDup.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Esta imagen ya fue utilizada.' });
            }

            // 6. GENERACIÓN MÚLTIPLE DE TICKETS
            const cantTickets = parseInt(cantidad) || 1;
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const codigosGenerados = [];

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
                    sql: `INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, ocr_monto, ocr_operacion)
                          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pendiente', ?, ?)`,
                    args: [sorteo_id, numero, nombre.toUpperCase(), dni || null, telefono || null, departamento ? departamento.toUpperCase() : null, base64Image, hashUnico, ocr.monto || null, operacionDetectada]
                });
            }

            // 7. RESPUESTA AL FRONTEND
            res.json({ 
                success: true, 
                codigos: codigosGenerados, // Arreglo de todos los tickets
                numero_ticket: codigosGenerados[0], // Primer ticket
                nombre_cliente: nombre, 
                sorteo_nombre: sorteo.nombre, 
                cantidad: cantTickets 
            });

        } catch (e) {
            console.error("Error al crear ticket:", e);
            res.status(500).json({ error: 'Error interno al guardar el ticket.' });
        }
    });
});

module.exports = router;
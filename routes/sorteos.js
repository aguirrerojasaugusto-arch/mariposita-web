const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const { extraerDatosLocal } = require('../services/ocrLocal');
const router = express.Router();

function generarCodigoTicket() {
    const numero = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
    return String(numero);
}

router.post('/tickets', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante.' });

        try {
            const validacion = await esComprobanteYape(req.file.buffer);
            if (!validacion.valido) return res.status(400).json({ error: validacion.error });

            const body = req.body || {};
            const sorteo_id = String(body.sorteo_id || '');
            const nombre = String(body.nombre || '');
            const telefono = String(body.telefono || '');
            const dni = body.dni ? String(body.dni) : '';
            const departamento = body.departamento ? String(body.departamento) : null;
            const cantidad = parseInt(body.cantidad, 10) || 1;
            
            if (!sorteo_id || !nombre || !telefono) {
                return res.status(400).json({ error: 'Faltan datos personales (Nombre o Teléfono).' });
            }

            const sorteoRes = await db.execute({
                sql: "SELECT * FROM sorteos WHERE id = ? AND estado = 'activo'",
                args: [sorteo_id]
            });
            const sorteo = sorteoRes.rows[0];
            if (!sorteo) return res.status(400).json({ error: 'El sorteo ya no está disponible.' });

            const fechaSorteo = new Date(`${sorteo.fecha_sorteo}T${sorteo.hora_sorteo || '23:59'}:00-05:00`);
            if (new Date() > fechaSorteo) return res.status(400).json({ error: '⚠️ Este sorteo ya ha finalizado.' });

            const ocr = await extraerDatosLocal(req.file.buffer);
            if (ocr.error_ocr) return res.status(400).json({ error: `Problema al leer la imagen: ${ocr.error_ocr}` });

            // 1. VALIDACIÓN DE MONTO
            const montoEsperado = parseFloat(sorteo.precio_ticket) * cantidad;
            
            if (!ocr.monto || isNaN(ocr.monto)) {
                return res.status(400).json({ error: 'No se pudo leer el monto en el comprobante. Asegúrate de que se vea claro.' });
            }

            if (Math.abs(ocr.monto - montoEsperado) > 0.10) {
                return res.status(400).json({ 
                    error: `❌ Monto incorrecto. Tu comprobante es de S/ ${ocr.monto.toFixed(2)}, pero debes pagar S/ ${montoEsperado.toFixed(2)}.` 
                });
            }

            // 2. VALIDACIÓN DE FECHA (MÁX 30 MINUTOS)
            if (!ocr.fecha_hora) {
                return res.status(400).json({ error: '❌ No se pudo leer la fecha y hora del comprobante. Sube una imagen más clara.' });
            }
            
            const ahora = new Date();
            const fechaComprobante = new Date(ocr.fecha_hora);
            const diferenciaMinutos = (ahora - fechaComprobante) / 1000 / 60;
            
            if (diferenciaMinutos > 30) {
                return res.status(400).json({ 
                    error: `❌ Comprobante muy antiguo. Han pasado ${Math.round(diferenciaMinutos)} minutos desde el pago. El límite es de 30 minutos.` 
                });
            }

            // 3. VALIDACIÓN ESTRICTA DE CELULAR DE DESTINO
            const configRes = await db.execute({ sql: "SELECT valor FROM configuracion WHERE clave = 'numero_yape'", args: [] });
            const numYape = configRes.rows[0]?.valor || '';

            if (!numYape.trim()) {
                return res.status(500).json({ error: '❌ Error del sistema: El número de Yape no está configurado en el panel.' });
            }

            if (!ocr.celular_destino) {
                return res.status(400).json({ error: '❌ No se pudo detectar el número de celular en el comprobante. Sube una imagen más clara.' });
            }

            const numLimpio = numYape.replace(/\D/g, ''); 
            const ultimos3 = numLimpio.slice(-3);
            
            if (ocr.celular_destino !== ultimos3) {
                return res.status(400).json({ 
                    error: `❌ El Yape fue enviado a otro número. El comprobante termina en *** *** ${ocr.celular_destino}, pero tu Yape termina en *** *** ${ultimos3}.` 
                });
            }

            // 4. VALIDACIÓN DE NÚMERO DE OPERACIÓN DUPLICADO
            if (!ocr.operacion) {
                return res.status(400).json({ error: 'No se encontró el Nro. de operación. Sube una captura donde se vea ese dato.' });
            }

            const opTicket = await db.execute({ sql: 'SELECT id FROM tickets WHERE ocr_operacion = ?', args: [ocr.operacion] });
            const opOrden = await db.execute({ sql: 'SELECT id FROM ordenes WHERE ocr_operacion = ?', args: [ocr.operacion] });
            
            if (opTicket.rows.length > 0 || opOrden.rows.length > 0) {
                return res.status(400).json({ error: `❌ El Nro. de operación (${ocr.operacion}) ya fue usado. Si tienes un problema, contacta a soporte.` });
            }

            // 5. VALIDACIÓN DE IMAGEN DUPLICADA (HASH)
            const hashBase = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante LIKE ?', args: [`${hashBase}%`] });
            
            if (ticketDup.rows.length > 0) {
                return res.status(400).json({ error: '❌ Esta imagen exacta ya fue subida anteriormente. Si es un error, contacta a soporte.' });
            }

            // --- INSERCIÓN ---
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const codigosGenerados = [];
            const ahoraPeru = "datetime('now', '-05:00')";

            for (let i = 0; i < cantidad; i++) {
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
                        String(sorteo_id), 
                        String(numero), 
                        String(nombre).toUpperCase(), 
                        String(dni).trim(), 
                        String(telefono).trim(), 
                        departamento ? String(departamento).toUpperCase() : null, 
                        String(base64Image), 
                        String(hashUnico), 
                        String(ocr.operacion), 
                        Number(ocr.monto)
                    ]
                });
            }

            res.json({ 
                success: true, 
                codigos: codigosGenerados,
                numero_ticket: codigosGenerados[0],
                mensaje: `✅ ¡Pago validado! Se generaron ${cantidad} tickets.` 
            });

        } catch (e) {
            console.error("Error al crear ticket:", e);
            res.status(500).json({ error: 'Error interno: ' + e.message });
        }
    });
});

module.exports = router;
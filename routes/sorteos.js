const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const { uploadComprobante } = require('../middleware/upload');
const { esComprobanteYape } = require('../services/validarComprobante');
const { extraerDatosComprobante } = require('../services/ocr');
const router = express.Router();

// Función auxiliar para limpiar textos (quita asteriscos, puntos, etc.)
function limpiarTexto(texto) {
    if (!texto) return '';
    return texto.toLowerCase()
        .replace(/[^a-záéíóúñ\s]/g, '') // Deja solo letras y espacios
        .replace(/\s+/g, ' ')          // Reemplaza múltiples espacios por uno solo
        .trim();
}

router.post('/tickets', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

        try {
            // 1. Validación visual (Colores y orientación)
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

            // 2. Procesar OCR
            const ocr = await extraerDatosComprobante(req.file.buffer);
            if (ocr.error_ocr) console.warn("OCR falló:", ocr.error_ocr);

            // ⭐ 3. VALIDACIÓN POR 3 LETRAS DEL NOMBRE Y APELLIDO ⭐
            const configRes = await db.execute("SELECT valor FROM configuracion WHERE clave = 'nombre_titular'");
            const nombreTitularConfigurado = configRes.rows[0] ? configRes.rows[0].valor : '';

            if (nombreTitularConfigurado) {
                // Limpiamos el nombre configurado (ej: "Marcos Utc*" -> "marcos utc")
                const nombreLimpioConfig = limpiarTexto(nombreTitularConfigurado);
                const palabrasConfig = nombreLimpioConfig.split(' ').filter(p => p.length > 1);
                
                // Tomamos las 3 primeras letras del Nombre (palabra 0) y Apellido (palabra 1)
                let prefijoNombre = '';
                let prefijoApellido = '';

                if (palabrasConfig.length >= 1) {
                    prefijoNombre = palabrasConfig[0].substring(0, 3);
                }
                if (palabrasConfig.length >= 2) {
                    prefijoApellido = palabrasConfig[1].substring(0, 3);
                }

                // Limpiamos el texto leído por la IA
                const textoLeido = limpiarTexto(`${ocr.destinatario || ''} ${ocr.texto_completo || ''}`);
                
                // Validación: El texto debe contener el prefijo del nombre Y el prefijo del apellido
                let esValido = false;

                if (prefijoNombre && prefijoApellido) {
                    // Buscamos si ambas partes (ej: "mar" y "utc") están presentes
                    if (textoLeido.includes(prefijoNombre) && textoLeido.includes(prefijoApellido)) {
                        esValido = true;
                    }
                } else if (prefijoNombre) {
                    // Si solo hay un nombre, validamos solo ese prefijo
                    if (textoLeido.includes(prefijoNombre)) {
                        esValido = true;
                    }
                }

                if (!esValido) {
                    return res.status(400).json({ 
                        error: `El comprobante no coincide con el titular configurado ("${nombreTitularConfigurado}"). Asegúrate de que el nombre y apellido sean legibles.` 
                    });
                }
            }

            // 4. VALIDACIÓN DE COMPROBANTE ÚNICO (HASH)
            const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            
            const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante = ?', args: [hash] });
            const ordenDup = await db.execute({ sql: 'SELECT id FROM ordenes WHERE hash_comprobante = ?', args: [hash] });
            
            if (ticketDup.rows.length > 0 || ordenDup.rows.length > 0) {
                return res.status(400).json({ error: '⚠️ Esta imagen de comprobante ya fue utilizada en otra compra.' });
            }

            if (ocr.operacion) {
                const opTicket = await db.execute({ sql: 'SELECT id FROM tickets WHERE ocr_operacion = ?', args: [ocr.operacion] });
                const opOrden = await db.execute({ sql: 'SELECT id FROM ordenes WHERE ocr_operacion = ?', args: [ocr.operacion] });
                if (opTicket.rows.length > 0 || opOrden.rows.length > 0) {
                    return res.status(400).json({ error: '⚠️ Este número de operación ya fue registrado en otra compra.' });
                }
            }

            // 5. Guardar el ticket
            const cantTickets = parseInt(cantidad) || 1;
            const countRes = await db.execute({ sql: 'SELECT COUNT(*) as c FROM tickets WHERE sorteo_id = ?', args: [sorteo_id] });
            const count = countRes.rows[0].c + 1;
            const numero = `S${sorteo.id}-${String(count).padStart(5, '0')}`;
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

            await db.execute({
                sql: `INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, ocr_monto, ocr_operacion)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
                args: [sorteo_id, numero, nombre, dni || null, telefono || null, departamento || null, cantTickets, base64Image, hash, ocr.monto || null, ocr.operacion || null]
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
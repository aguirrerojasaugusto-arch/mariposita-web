const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const multer = require('multer');
const { validarImagenOrden } = require('../services/validarComprobanteOrdenes');
const { extraerDatosLocal } = require('../services/ocrLocal');
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

router.get('/buscar-cliente/:dni', async (req, res) => {
    const dni = req.params.dni;
    if (!dni) return res.status(400).json({ error: 'DNI requerido' });

    try {
        const result = await db.execute({
            sql: `SELECT cliente_nombre as nombre, cliente_telefono as telefono, cliente_direccion as direccion 
                  FROM ordenes WHERE cliente_dni = ? ORDER BY creado_en DESC LIMIT 1`,
            args: [dni],
            mode: "write"
        });
        const cliente = result.rows[0];
        if (cliente) res.json({ encontrado: true, cliente });
        else res.json({ encontrado: false, cliente: null });
    } catch (error) {
        res.status(500).json({ error: 'Error interno al buscar el DNI' });
    }
});

router.post('/ordenes', upload.single('comprobante'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante.' });

    try {
        const validacion = await validarImagenOrden(req.file.buffer);
        if (!validacion.valido) return res.status(400).json({ error: validacion.error });

        const { nombre, telefono, direccion, items, dni } = req.body;
        if (!nombre || !telefono || !direccion || !dni) {
            return res.status(400).json({ error: 'Faltan datos personales (Nombre, DNI, Teléfono o Dirección).' });
        }

        let itemsParsed;
        try { itemsParsed = JSON.parse(items); } catch { itemsParsed = null; }
        if (!Array.isArray(itemsParsed) || itemsParsed.length === 0) return res.status(400).json({ error: 'El carrito está vacío.' });

        let total = 0;
        const validItems = [];
        for (const it of itemsParsed) {
            const prodRes = await db.execute({ sql: 'SELECT * FROM productos WHERE id = ? AND activo = 1', args: [it.producto_id] });
            const prod = prodRes.rows[0];
            if (!prod) return res.status(400).json({ error: 'Producto no encontrado.' });
            const cant = parseInt(it.cantidad, 10);
            if (!cant || cant < 1) return res.status(400).json({ error: 'Cantidad inválida.' });
            if (prod.stock < cant) return res.status(400).json({ error: `Stock insuficiente: ${prod.nombre}` });
            total += prod.precio * cant;
            validItems.push({ producto_id: prod.id, cantidad: cant, precio: prod.precio });
        }

        const ocr = await extraerDatosLocal(req.file.buffer);
        
        // 1. VALIDACIÓN DE MONTO
        if (!ocr.monto) {
            return res.status(400).json({ error: 'No se pudo leer el monto en el comprobante. Asegúrate de que se vea claro.' });
        }

        if (Math.abs(ocr.monto - total) > 0.10) {
            return res.status(400).json({ 
                error: `❌ Monto incorrecto. Tu comprobante es de S/ ${ocr.monto.toFixed(2)}, pero el total de tu carrito es S/ ${total.toFixed(2)}.` 
            });
        }

        // 2. VALIDACIÓN ESTRICTA DE CELULAR DE DESTINO
        const configRes = await db.execute({ sql: "SELECT valor FROM configuracion WHERE clave = 'numero_yape'" });
        const numYape = configRes.rows[0]?.valor || '';

        if (!ocr.celular_destino) {
            return res.status(400).json({ error: '❌ No se pudo detectar el número de celular en el comprobante. Sube una imagen más clara.' });
        }

        if (numYape) {
            const numLimpio = numYape.replace(/\D/g, '');
            const ultimos3 = numLimpio.slice(-3);
            
            if (ocr.celular_destino !== ultimos3) {
                return res.status(400).json({ 
                    error: `❌ El Yape fue enviado a otro número. El comprobante termina en *** *** ${ocr.celular_destino}, pero tu Yape termina en ${ultimos3}.` 
                });
            }
        }

        // 3. VALIDACIÓN DE DUPLICADOS (HASH)
        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante LIKE ?', args: [`${hash}%`] });
        const ordenDup = await db.execute({ sql: 'SELECT id FROM ordenes WHERE hash_comprobante = ?', args: [hash] });
        
        if (ticketDup.rows.length > 0 || ordenDup.rows.length > 0) {
            return res.status(400).json({ error: '❌ Esta imagen exacta ya fue subida anteriormente. Si es un error, contacta a soporte.' });
        }

        // 4. VALIDACIÓN DE NÚMERO DE OPERACIÓN
        if (!ocr.operacion) {
            return res.status(400).json({ error: 'No se encontró el Nro. de operación. Sube una captura donde se vea ese dato.' });
        }

        const opTicket = await db.execute({ sql: 'SELECT id FROM tickets WHERE ocr_operacion = ?', args: [ocr.operacion] });
        const opOrden = await db.execute({ sql: 'SELECT id FROM ordenes WHERE ocr_operacion = ?', args: [ocr.operacion] });
        if (opTicket.rows.length > 0 || opOrden.rows.length > 0) {
            return res.status(400).json({ error: `❌ El Nro. de operación (${ocr.operacion}) ya fue usado. Si tienes un problema, contacta a soporte.` });
        }

        // --- INSERCIÓN ---
        const countRes = await db.execute('SELECT COUNT(*) as c FROM ordenes');
        const count = countRes.rows[0].c + 1;
        const year = new Date().getFullYear();
        const codigo = `MAR-${year}-${String(count).padStart(4, '0')}`;
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        const insertRes = await db.execute({
            sql: `INSERT INTO ordenes (codigo, cliente_nombre, cliente_dni, cliente_email, cliente_telefono, cliente_direccion,
                    total, comprobante_base64, hash_comprobante, estado, ocr_monto, ocr_fecha, ocr_operacion)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
            args: [codigo, nombre, dni, null, telefono, direccion, total, base64Image, hash, ocr.monto, null, ocr.operacion]
        });

        const ordenId = insertRes.lastInsertRowid;

        for (const it of validItems) {
            await db.execute({
                sql: 'INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
                args: [ordenId, it.producto_id, it.cantidad, it.precio]
            });
        }

        res.json({ success: true, codigo, total, mensaje: '✅ ¡Orden recibida! Tu pago ha sido validado.' });
        
    } catch (e) {
        console.error("Error procesando orden:", e);
        res.status(500).json({ error: 'Error interno al procesar la orden.' });
    }
});

module.exports = router;
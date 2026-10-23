const express = require('express');
const crypto = require('crypto');
const { db } = require('../database');
const multer = require('multer');
const { validarImagenOrden } = require('../services/validarComprobanteOrdenes');
const { extraerDatosOrden } = require('../services/ocr_ordenes');
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

router.get('/buscar-cliente/:dni', async (req, res) => {
    const dni = req.params.dni;
    if (!dni) return res.status(400).json({ error: 'DNI requerido' });

    try {
        const result = await db.execute({
            sql: `SELECT cliente_nombre as nombre, cliente_telefono as telefono, cliente_direccion as direccion 
                  FROM ordenes WHERE cliente_dni = ? ORDER BY creado_en DESC LIMIT 1`,
            args: [dni]
        });
        const cliente = result.rows[0];
        if (cliente) res.json({ encontrado: true, cliente });
        else res.json({ encontrado: false, cliente: null });
    } catch (error) {
        res.status(500).json({ error: 'Error interno al buscar el DNI' });
    }
});

router.post('/ordenes', upload.single('comprobante'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

    try {
        const validacion = await validarImagenOrden(req.file.buffer);
        if (!validacion.valido) return res.status(400).json({ error: validacion.error });

        const { nombre, telefono, direccion, items, dni } = req.body;
        if (!nombre || !telefono || !direccion || !dni) {
            return res.status(400).json({ error: 'Faltan datos personales (Nombre, DNI, Teléfono o Dirección)' });
        }

        let itemsParsed;
        try { itemsParsed = JSON.parse(items); } catch { itemsParsed = null; }
        if (!Array.isArray(itemsParsed) || itemsParsed.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

        let total = 0;
        const validItems = [];
        for (const it of itemsParsed) {
            const prodRes = await db.execute({ sql: 'SELECT * FROM productos WHERE id = ? AND activo = 1', args: [it.producto_id] });
            const prod = prodRes.rows[0];
            if (!prod) return res.status(400).json({ error: 'Producto no encontrado' });
            const cant = parseInt(it.cantidad, 10);
            if (!cant || cant < 1) return res.status(400).json({ error: 'Cantidad inválida' });
            if (prod.stock < cant) return res.status(400).json({ error: `Stock insuficiente: ${prod.nombre}` });
            total += prod.precio * cant;
            validItems.push({ producto_id: prod.id, cantidad: cant, precio: prod.precio });
        }

        const ocr = await extraerDatosOrden(req.file.buffer);
        
        // ⭐ VALIDACIÓN DE NOMBRE (ÓRDENES) ⭐
        if (ocr.destinatario || ocr.texto_completo) {
            const nombreParaValidar = nombre.trim().toLowerCase();
            const palabrasNombre = nombreParaValidar.split(' ').filter(p => p.length > 2);
            const textoAValidar = `${ocr.destinatario || ''} ${ocr.texto_completo || ''}`.toLowerCase();
            const nombreCoincide = palabrasNombre.some(palabra => textoAValidar.includes(palabra));

            if (!nombreCoincide) {
                return res.status(400).json({ 
                    error: `El nombre ingresado ("${nombre}") no coincide con el destinatario del comprobante.` 
                });
            }
        }

        // ⭐ VALIDACIÓN DE DUPLICADOS (ÓRDENES) ⭐
        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const ticketDup = await db.execute({ sql: 'SELECT id FROM tickets WHERE hash_comprobante = ?', args: [hash] });
        const ordenDup = await db.execute({ sql: 'SELECT id FROM ordenes WHERE hash_comprobante = ?', args: [hash] });
        
        if (ticketDup.rows.length > 0 || ordenDup.rows.length > 0) {
            return res.status(400).json({ error: '⚠️ Esta imagen ya fue utilizada.' });
        }

        const countRes = await db.execute('SELECT COUNT(*) as c FROM ordenes');
        const count = countRes.rows[0].c + 1;
        const year = new Date().getFullYear();
        const codigo = `MAR-${year}-${String(count).padStart(4, '0')}`;
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        const insertRes = await db.execute({
            sql: `INSERT INTO ordenes (codigo, cliente_nombre, cliente_dni, cliente_email, cliente_telefono, cliente_direccion,
                    total, comprobante_base64, hash_comprobante, estado, ocr_monto, ocr_fecha, ocr_operacion)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
            args: [codigo, nombre, dni, null, telefono, direccion, total, base64Image, hash, ocr.monto || null, ocr.fecha || null, ocr.operacion || null]
        });

        const ordenId = insertRes.lastInsertRowid;

        for (const it of validItems) {
            await db.execute({
                sql: 'INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
                args: [ordenId, it.producto_id, it.cantidad, it.precio]
            });
        }

        res.json({ success: true, codigo, total, mensaje: 'Orden recibida correctamente.' });
        
    } catch (e) {
        console.error("Error procesando orden:", e);
        res.status(500).json({ error: 'Error interno al procesar la orden.' });
    }
});

module.exports = router;
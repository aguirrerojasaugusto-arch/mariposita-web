const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { db } = require('../database');
const { requireAdmin, requireVendedor } = require('../middleware/auth');
const { uploadProducto } = require('../middleware/upload');

const router = express.Router();
router.use(requireVendedor); 

const storageMemory = multer.memoryStorage();
const uploadConfig = multer({ 
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 }
}).single('imagen');

const uploadCarruselMemory = multer({ 
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 }
}).single('imagen');

function generarCodigoTicket() {
    const numero = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
    return String(numero);
}

// ============ DASHBOARD ============
router.get('/dashboard', async (req, res) => {
    try {
        const op = await db.execute("SELECT COUNT(*) as c FROM ordenes WHERE estado='pendiente'");
        const tp = await db.execute("SELECT COUNT(*) as c FROM tickets WHERE estado_pago='pendiente'");
        const va = await db.execute("SELECT COALESCE(SUM(total),0) as t FROM ordenes WHERE estado='aprobado'");
        const to = await db.execute("SELECT COUNT(*) as c FROM ordenes");
        res.json({ 
            ordenes_pendientes: op.rows[0].c, 
            tickets_pendientes: tp.rows[0].c, 
            ventas_aprobadas: va.rows[0].t, 
            total_ordenes: to.rows[0].c 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ CONFIGURACIÓN ============
router.get('/configuracion', requireAdmin, async (req, res) => {
    try {
        const result = await db.execute('SELECT clave, valor FROM configuracion');
        const obj = {};
        result.rows.forEach(r => obj[r.clave] = r.valor);
        res.json(obj);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/configuracion', requireAdmin, async (req, res) => {
    const data = req.body || {};
    try {
        for (const [k, v] of Object.entries(data)) {
            await db.execute({
                sql: 'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
                args: [k, String(v)]
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/configuracion-imagenes', requireAdmin, (req, res) => {
    uploadConfig(req, res, async (err) => {
        if (err) return res.status(400).json({ error: 'Error al subir la imagen' });
        const { tipo } = req.body;
        if (!tipo || !req.file) return res.status(400).json({ error: 'Faltan datos' });

        try {
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const clave = tipo === 'logo' ? 'logo_admin' : (tipo === 'fondo' ? 'fondo_login' : 'flyer_inicio');
            await db.execute({
                sql: 'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
                args: [clave, base64Image]
            });
            res.json({ success: true, mensaje: 'Imagen actualizada correctamente' });
        } catch (error) {
            res.status(500).json({ error: 'Error al guardar en la base de datos' });
        }
    });
});

// ============ ÓRDENES ============
router.get('/ordenes/pendientes', async (req, res) => {
    try {
        const result = await db.execute(`SELECT o.*, (SELECT COUNT(*) FROM orden_items WHERE orden_id = o.id) as total_items FROM ordenes o WHERE o.estado = 'pendiente' ORDER BY o.creado_en DESC`);
        res.json(result.rows.map(o => ({ ...o, alerta_monto: o.ocr_monto !== null && Math.abs(o.total - o.ocr_monto) > 0.01, alerta_ocr: !!o.ocr_error })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ordenes', async (req, res) => {
    try {
        const estado = req.query.estado;
        let sql = 'SELECT * FROM ordenes';
        const args = [];
        if (estado) { sql += ' WHERE estado = ?'; args.push(estado); }
        sql += ' ORDER BY creado_en DESC LIMIT 200';
        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ordenes/:id', async (req, res) => {
    try {
        const ordRes = await db.execute({ sql: 'SELECT * FROM ordenes WHERE id = ?', args: [req.params.id] });
        const orden = ordRes.rows[0];
        if (!orden) return res.status(404).json({ error: 'No encontrada' });
        
        const itemsRes = await db.execute({
            sql: `SELECT oi.*, p.nombre, p.imagen_base64 FROM orden_items oi JOIN productos p ON p.id = oi.producto_id WHERE oi.orden_id = ?`,
            args: [orden.id]
        });
        res.json({ ...orden, items: itemsRes.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ordenes/:id/revisar', requireAdmin, async (req, res) => {
    const { accion, notas } = req.body || {};
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    try {
        const ordRes = await db.execute({ sql: 'SELECT * FROM ordenes WHERE id = ?', args: [req.params.id] });
        const orden = ordRes.rows[0];
        if (!orden) return res.status(404).json({ error: 'No encontrada' });
        if (orden.estado !== 'pendiente') return res.status(400).json({ error: 'Ya fue revisada' });

        const nuevoEstado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        
        const queries = [
            { sql: 'UPDATE ordenes SET estado = ?, notas_admin = ? WHERE id = ?', args: [nuevoEstado, notas || null, orden.id] }
        ];

        if (accion === 'aprobar') {
            const itemsRes = await db.execute({ sql: 'SELECT * FROM orden_items WHERE orden_id = ?', args: [orden.id] });
            for (const it of itemsRes.rows) {
                queries.push({ sql: 'UPDATE productos SET stock = stock - ? WHERE id = ?', args: [it.cantidad, it.producto_id] });
            }
        }

        queries.push({ sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)', args: [req.user.userId, `${accion.toUpperCase()}_ORDEN`, `Orden ${orden.codigo}`, req.ip, ahora] });

        await db.batch(queries, "write");
        res.json({ success: true, nuevo_estado: nuevoEstado });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ TICKETS ============
router.get('/tickets/pendientes', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT 
                SUBSTR(t.hash_comprobante, 1, INSTR(t.hash_comprobante, '-') - 1) as grupo_id,
                MIN(t.id) as id,
                MIN(t.numero_ticket) as numero_ticket,
                t.cliente_nombre,
                t.cliente_dni,
                t.cliente_telefono,
                s.nombre as sorteo_nombre,
                COUNT(t.id) as cantidad_tickets,
                SUM(s.precio_ticket) as total_pagado,
                MIN(t.creado_en) as creado_en,
                t.comprobante_base64,
                t.notas_admin,
                MAX(t.ocr_monto) as ocr_monto,
                MAX(t.ocr_operacion) as ocr_operacion,
                MAX(t.ocr_error) as ocr_error
            FROM tickets t
            JOIN sorteos s ON s.id = t.sorteo_id
            WHERE t.estado_pago = 'pendiente'
            GROUP BY grupo_id, t.sorteo_id
            ORDER BY creado_en DESC
        `);
        
        res.json(result.rows.map(t => ({ 
            ...t, 
            alerta_monto: t.ocr_monto !== null && Math.abs(t.total_pagado - t.ocr_monto) > 0.01, 
            alerta_ocr: !!t.ocr_error,
            notas_admin: t.notas_admin
        })));
    } catch (e) { 
        console.error("Error en tickets pendientes:", e);
        res.status(500).json({ error: e.message }); 
    }
});

router.get('/tickets/aprobados', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT t.*, s.nombre as sorteo_nombre 
            FROM tickets t 
            JOIN sorteos s ON s.id = t.sorteo_id 
            WHERE t.estado_pago = 'aprobado' 
            ORDER BY t.creado_en DESC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tickets/:id/revisar', requireAdmin, async (req, res) => {
    const { accion, notas } = req.body || {};
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    try {
        const tRes = await db.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [req.params.id] });
        const t = tRes.rows[0];
        if (!t) return res.status(404).json({ error: 'No encontrado' });

        const hashBase = t.hash_comprobante.split('-')[0];
        const nuevo = accion === 'aprobar' ? 'aprobado' : 'rechazado';
        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        
        await db.batch([
            { 
                sql: `UPDATE tickets SET estado_pago = ?, notas_admin = ? WHERE hash_comprobante LIKE ? AND sorteo_id = ?`, 
                args: [nuevo, notas || t.notas_admin || null, `${hashBase}%`, t.sorteo_id] 
            },
            { 
                sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)', 
                args: [req.user.userId, `${accion.toUpperCase()}_TICKET_GRUPAL`, `Grupo de tickets de ${t.cliente_nombre}`, req.ip, ahora] 
            }
        ], "write");

        res.json({ success: true, nuevo_estado: nuevo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tickets/vender', async (req, res) => {
    const { sorteo_id, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad } = req.body;
    
    if (!sorteo_id || !cliente_nombre || !cliente_dni) {
        return res.status(400).json({ error: 'Faltan datos (Sorteo, Nombre y DNI son obligatorios)' });
    }

    try {
        const sorteoRes = await db.execute({ sql: "SELECT * FROM sorteos WHERE id = ?", args: [sorteo_id] });
        const sorteo = sorteoRes.rows[0];
        if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });

        const cantTickets = parseInt(cantidad) || 1;
        const codigosGenerados = [];
        const hashBase = crypto.randomBytes(16).toString('hex');

        for (let i = 0; i < cantTickets; i++) {
            let numero;
            let isUnique = false;
            while (!isUnique) {
                numero = generarCodigoTicket();
                const check = await db.execute({ sql: 'SELECT id FROM tickets WHERE numero_ticket = ?', args: [numero] });
                if (check.rows.length === 0) isUnique = true;
            }
            codigosGenerados.push(numero);

            await db.execute({
                sql: `INSERT INTO tickets (sorteo_id, numero_ticket, cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento, cantidad_tickets, estado_pago, notas_admin, creado_en, hash_comprobante)
                      VALUES (?, ?, ?, ?, ?, ?, 1, 'aprobado', 'Venta presencial en tienda', datetime('now', 'localtime'), ?)`,
                args: [sorteo_id, numero, cliente_nombre, cliente_dni, cliente_telefono || null, cliente_departamento || null, `${hashBase}-${numero}`]
            });
        }

        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)',
            args: [req.user.userId, 'VENTA_PRESENCIAL', `Vendió ${cantTickets} ticket(s) a ${cliente_nombre}`, req.ip, ahora]
        });

        res.json({ success: true, codigos: codigosGenerados, numero_ticket: codigosGenerados[0], mensaje: 'Venta registrada correctamente' });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: e.message }); 
    }
});

router.delete('/tickets/:id', requireAdmin, async (req, res) => {
    try {
        await db.execute({ sql: 'DELETE FROM tickets WHERE id = ?', args: [req.params.id] });
        res.json({ success: true, mensaje: 'Ticket eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar el ticket' });
    }
});

router.put('/tickets/:id/editar', requireAdmin, async (req, res) => {
    const { cliente_nombre, cliente_dni, cliente_telefono, cliente_departamento } = req.body;
    try {
        await db.execute({
            sql: `UPDATE tickets SET cliente_nombre = ?, cliente_dni = ?, cliente_telefono = ?, cliente_departamento = ? WHERE id = ?`,
            args: [
                cliente_nombre ? cliente_nombre.toUpperCase() : 'SIN NOMBRE', 
                cliente_dni || null, 
                cliente_telefono || null, 
                cliente_departamento ? cliente_departamento.toUpperCase() : null, 
                req.params.id
            ]
        });
        res.json({ success: true, mensaje: 'Ticket actualizado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar el ticket' });
    }
});

// ============ PRODUCTOS ============
router.get('/productos', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM productos ORDER BY creado_en DESC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/productos', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio, stock, categoria } = req.body;
        let imagen_path = req.file ? `/uploads/imagenes/${req.file.filename}` : null;

        try {
            let precioFinal = null;
            if (precio !== undefined && precio !== null && precio !== '') {
                const parsed = parseFloat(precio);
                if (Number.isFinite(parsed)) precioFinal = parsed;
            }

            let stockFinal = 0;
            if (stock !== undefined && stock !== null && stock !== '') {
                const parsed = parseInt(stock, 10);
                if (Number.isFinite(parsed)) stockFinal = parsed;
            }

            const r = await db.execute({
                sql: `INSERT INTO productos (nombre, descripcion, precio, stock, imagen_base64, categoria) VALUES (?, ?, ?, ?, ?, ?)`,
                args: [nombre, descripcion || null, precioFinal, stockFinal, imagen_path, categoria || 'ropa_tipica']
            });
            res.json({ success: true, id: Number(r.lastInsertRowid) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.put('/productos/:id', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio, stock, categoria, activo } = req.body;

        try {
            const pRes = await db.execute({ sql: 'SELECT * FROM productos WHERE id = ?', args: [req.params.id] });
            const p = pRes.rows[0];
            if (!p) return res.status(404).json({ error: 'No encontrado' });

            let imagen_path = p.imagen_base64;
            if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;

            let precioFinal = p.precio;
            if (precio !== undefined && precio !== null && precio !== '') {
                const parsed = parseFloat(precio);
                if (Number.isFinite(parsed)) precioFinal = parsed;
            } else if (precio === '') {
                precioFinal = null;
            }

            let stockFinal = p.stock;
            if (stock !== undefined && stock !== null && stock !== '') {
                const parsed = parseInt(stock, 10);
                if (Number.isFinite(parsed)) stockFinal = parsed;
            }

            await db.execute({
                sql: `UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, imagen_base64=?, categoria=?, activo=? WHERE id=?`,
                args: [nombre || p.nombre, descripcion ?? p.descripcion, precioFinal, stockFinal, imagen_path, categoria || p.categoria, activo !== undefined ? parseInt(activo) : p.activo, p.id]
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.delete('/productos/:id', requireAdmin, async (req, res) => {
    try {
        await db.execute({ sql: 'UPDATE productos SET activo = 0 WHERE id = ?', args: [req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ SORTEOS ============
router.get('/sorteos', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM sorteos ORDER BY creado_en DESC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sorteos', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio_ticket, fecha_sorteo, hora_sorteo, estado } = req.body;
        let imagen_path = req.file ? `/uploads/imagenes/${req.file.filename}` : null;

        const horaFinal = hora_sorteo ? hora_sorteo.substring(0, 5) : '23:59';

        try {
            const r = await db.execute({
                sql: `INSERT INTO sorteos (nombre, descripcion, precio_ticket, imagen_base64, fecha_sorteo, hora_sorteo, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [nombre, descripcion || null, parseFloat(precio_ticket), imagen_path, fecha_sorteo, horaFinal, estado || 'activo']
            });
            res.json({ success: true, id: Number(r.lastInsertRowid) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.put('/sorteos/:id', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio_ticket, fecha_sorteo, hora_sorteo, estado } = req.body;

        try {
            const sRes = await db.execute({ sql: 'SELECT * FROM sorteos WHERE id = ?', args: [req.params.id] });
            const s = sRes.rows[0];
            if (!s) return res.status(404).json({ error: 'No encontrado' });

            let imagen_path = s.imagen_base64;
            if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;

            const horaFinal = hora_sorteo ? hora_sorteo.substring(0, 5) : s.hora_sorteo;

            await db.execute({
                sql: `UPDATE sorteos SET nombre=?, descripcion=?, precio_ticket=?, imagen_base64=?, fecha_sorteo=?, hora_sorteo=?, estado=? WHERE id=?`,
                args: [nombre || s.nombre, descripcion ?? s.descripcion, precio_ticket ? parseFloat(precio_ticket) : s.precio_ticket, imagen_path, fecha_sorteo || s.fecha_sorteo, horaFinal, estado || s.estado, s.id]
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.delete('/sorteos/:id', requireAdmin, async (req, res) => {
    try {
        await db.batch([
            { sql: 'DELETE FROM tickets WHERE sorteo_id = ?', args: [req.params.id] },
            { sql: 'DELETE FROM sorteos WHERE id = ?', args: [req.params.id] }
        ], "write");
        res.json({ success: true, mensaje: 'Sorteo eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar el sorteo' });
    }
});

// ============ CARRUSEL ============
router.get('/carrusel', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM carrusel ORDER BY orden ASC, id ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/carrusel', requireAdmin, (req, res) => {
    uploadCarruselMemory(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir una imagen' });

        try {
            const countRes = await db.execute('SELECT COUNT(*) as c FROM carrusel');
            const count = countRes.rows[0].c;
            if (count >= 5) return res.status(400).json({ error: 'El carrusel solo permite 5 imágenes.' });
            
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            
            await db.execute({
                sql: 'INSERT INTO carrusel (imagen_base64, orden) VALUES (?, ?)',
                args: [base64Image, count]
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.delete('/carrusel/:id', requireAdmin, async (req, res) => {
    try {
        await db.execute({ sql: 'DELETE FROM carrusel WHERE id = ?', args: [req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ GANADORES ============
router.get('/ganadores', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT g.*, s.nombre as sorteo_nombre 
            FROM ganadores g JOIN sorteos s ON s.id = g.sorteo_id ORDER BY g.creado_en DESC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ganadores', requireAdmin, async (req, res) => {
    const { sorteo_id, cliente_nombre, numero_ticket, premio } = req.body;
    if (!sorteo_id || !cliente_nombre || !numero_ticket) return res.status(400).json({ error: 'Faltan datos' });
    try {
        await db.execute({
            sql: `INSERT INTO ganadores (sorteo_id, cliente_nombre, numero_ticket, premio) VALUES (?, ?, ?, ?)`,
            args: [sorteo_id, cliente_nombre.toUpperCase(), numero_ticket, premio || null]
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/ganadores/:id', requireAdmin, async (req, res) => {
    try {
        await db.execute({ sql: 'DELETE FROM ganadores WHERE id = ?', args: [req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
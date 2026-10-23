const express = require('express');
const multer = require('multer');
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

// ============ DASHBOARD ============
router.get('/dashboard', async (req, res) => {
    try {
        const op = await db.execute("SELECT COUNT(*) as c FROM ordenes WHERE estado='pendiente'");
        const tp = await db.execute("SELECT COUNT(*) as c FROM tickets WHERE estado_pago='pendiente'");
        const va = await db.execute("SELECT COALESCE(SUM(total),0) as t FROM ordenes WHERE estado='aprobado'");
        const to = await db.execute("SELECT COUNT(*) as c FROM ordenes");
        res.json({ ordenes_pendientes: op.rows[0].c, tickets_pendientes: tp.rows[0].c, ventas_aprobadas: va.rows[0].t, total_ordenes: to.rows[0].c });
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
            await db.execute({ sql: 'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)', args: [k, String(v)] });
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
            const clave = tipo === 'logo' ? 'logo_admin' : 'fondo_login';
            await db.execute({ sql: 'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)', args: [clave, base64Image] });
            res.json({ success: true, mensaje: 'Imagen actualizada correctamente' });
        } catch (error) { res.status(500).json({ error: 'Error al guardar' }); }
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
        
        const itemsRes = await db.execute({ sql: `SELECT oi.*, p.nombre, p.imagen_base64 FROM orden_items oi JOIN productos p ON p.id = oi.producto_id WHERE oi.orden_id = ?`, args: [orden.id] });
        res.json({ ...orden, items: itemsRes.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ordenes/:id/revisar', async (req, res) => {
    const { accion, notas } = req.body || {};
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    try {
        const ordRes = await db.execute({ sql: 'SELECT * FROM ordenes WHERE id = ?', args: [req.params.id] });
        const orden = ordRes.rows[0];
        if (!orden) return res.status(404).json({ error: 'No encontrada' });
        if (orden.estado !== 'pendiente') return res.status(400).json({ error: 'Ya fue revisada' });

        const nuevoEstado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        
        const queries = [{ sql: 'UPDATE ordenes SET estado = ?, notas_admin = ? WHERE id = ?', args: [nuevoEstado, notas || null, orden.id] }];

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
        const result = await db.execute(`SELECT t.*, s.nombre as sorteo_nombre, s.precio_ticket FROM tickets t JOIN sorteos s ON s.id = t.sorteo_id WHERE t.estado_pago = 'pendiente' ORDER BY t.creado_en DESC`);
        res.json(result.rows.map(t => ({ ...t, alerta_monto: t.ocr_monto !== null && Math.abs(t.precio_ticket - t.ocr_monto) > 0.01, alerta_ocr: !!t.ocr_error })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tickets/:id/revisar', async (req, res) => {
    const { accion, notas } = req.body || {};
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    try {
        const tRes = await db.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [req.params.id] });
        const t = tRes.rows[0];
        if (!t) return res.status(404).json({ error: 'No encontrado' });
        if (t.estado_pago !== 'pendiente') return res.status(400).json({ error: 'Ya fue revisado' });

        const nuevo = accion === 'aprobar' ? 'aprobado' : 'rechazado';
        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        
        await db.batch([
            { sql: 'UPDATE tickets SET estado_pago = ?, notas_admin = ? WHERE id = ?', args: [nuevo, notas || null, t.id] },
            { sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)', args: [req.user.userId, `${accion.toUpperCase()}_TICKET`, `Ticket ${t.numero_ticket}`, req.ip, ahora] }
        ], "write");

        res.json({ success: true, nuevo_estado: nuevo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ PRODUCTOS ============
router.get('/productos', async (req, res) => {
    try { const result = await db.execute('SELECT * FROM productos ORDER BY creado_en DESC'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/productos', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio, stock, categoria } = req.body;
        let imagen_path = req.file ? `/uploads/imagenes/${req.file.filename}` : null;
        try {
            const r = await db.execute({ sql: `INSERT INTO productos (nombre, descripcion, precio, stock, imagen_base64, categoria) VALUES (?, ?, ?, ?, ?, ?)`, args: [nombre, descripcion || null, parseFloat(precio), parseInt(stock) || 0, imagen_path, categoria || 'ropa_tipica'] });
            res.json({ success: true, id: r.lastInsertRowid });
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
            await db.execute({ sql: `UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, imagen_base64=?, categoria=?, activo=? WHERE id=?`, args: [nombre || p.nombre, descripcion ?? p.descripcion, precio ? parseFloat(precio) : p.precio, stock !== undefined ? parseInt(stock) : p.stock, imagen_path, categoria || p.categoria, activo !== undefined ? parseInt(activo) : p.activo, p.id] });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.delete('/productos/:id', requireAdmin, async (req, res) => {
    try { await db.execute({ sql: 'UPDATE productos SET activo = 0 WHERE id = ?', args: [req.params.id] }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ SORTEOS ============
router.get('/sorteos', async (req, res) => {
    try { const result = await db.execute('SELECT * FROM sorteos ORDER BY creado_en DESC'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sorteos', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio_ticket, fecha_sorteo, estado } = req.body;
        let imagen_path = req.file ? `/uploads/imagenes/${req.file.filename}` : null;
        try {
            const r = await db.execute({ sql: `INSERT INTO sorteos (nombre, descripcion, precio_ticket, imagen_base64, fecha_sorteo, estado) VALUES (?, ?, ?, ?, ?, ?)`, args: [nombre, descripcion || null, parseFloat(precio_ticket), imagen_path, fecha_sorteo, estado || 'activo'] });
            res.json({ success: true, id: r.lastInsertRowid });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.put('/sorteos/:id', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio_ticket, fecha_sorteo, estado } = req.body;
        try {
            const sRes = await db.execute({ sql: 'SELECT * FROM sorteos WHERE id = ?', args: [req.params.id] });
            const s = sRes.rows[0];
            if (!s) return res.status(404).json({ error: 'No encontrado' });
            let imagen_path = s.imagen_base64;
            if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;
            await db.execute({ sql: `UPDATE sorteos SET nombre=?, descripcion=?, precio_ticket=?, imagen_base64=?, fecha_sorteo=?, estado=? WHERE id=?`, args: [nombre || s.nombre, descripcion ?? s.descripcion, precio_ticket ? parseFloat(precio_ticket) : s.precio_ticket, imagen_path, fecha_sorteo || s.fecha_sorteo, estado || s.estado, s.id] });
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
    } catch (error) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// ============ CARRUSEL ============
router.get('/carrusel', async (req, res) => {
    try { const result = await db.execute('SELECT * FROM carrusel ORDER BY orden ASC, id ASC'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/carrusel', requireAdmin, (req, res) => {
    uploadProducto(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir una imagen' });
        try {
            const countRes = await db.execute('SELECT COUNT(*) as c FROM carrusel');
            const count = countRes.rows[0].c;
            if (count >= 5) return res.status(400).json({ error: 'El carrusel solo permite 5 imágenes.' });
            const imagen_path = `/uploads/imagenes/${req.file.filename}`;
            await db.execute({ sql: 'INSERT INTO carrusel (imagen_base64, orden) VALUES (?, ?)', args: [imagen_path, count] });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

router.delete('/carrusel/:id', requireAdmin, async (req, res) => {
    try { await db.execute({ sql: 'DELETE FROM carrusel WHERE id = ?', args: [req.params.id] }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { uploadProducto } = require('../middleware/upload');

const router = express.Router();
router.use(requireAdmin);

// Configuración de Multer exclusiva para las imágenes de configuración (Logo y Fondo)
const storageMemory = multer.memoryStorage();
const uploadConfig = multer({ 
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB máximo
}).single('imagen');

// ============ DASHBOARD ============
router.get('/dashboard', (req, res) => {
    const ordenesPend = db.prepare("SELECT COUNT(*) as c FROM ordenes WHERE estado='pendiente'").get().c;
    const ticketsPend = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE estado_pago='pendiente'").get().c;
    const ventasAprob = db.prepare("SELECT COALESCE(SUM(total),0) as t FROM ordenes WHERE estado='aprobado'").get().t;
    const totalOrdenes = db.prepare("SELECT COUNT(*) as c FROM ordenes").get().c;
    res.json({ ordenes_pendientes: ordenesPend, tickets_pendientes: ticketsPend, ventas_aprobadas: ventasAprob, total_ordenes: totalOrdenes });
});

// ============ CONFIGURACIÓN ============
router.get('/configuracion', (req, res) => {
    const rows = db.prepare('SELECT clave, valor FROM configuracion').all();
    const obj = {};
    rows.forEach(r => obj[r.clave] = r.valor);
    res.json(obj);
});

router.post('/configuracion', (req, res) => {
    const data = req.body || {};
    const upd = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
    const tx = db.transaction(() => { Object.entries(data).forEach(([k, v]) => upd.run(k, String(v))); });
    tx();
    res.json({ success: true });
});

// Subida de Logo y Fondo
router.post('/configuracion-imagenes', (req, res) => {
    uploadConfig(req, res, (err) => {
        if (err) {
            console.error("Error Multer:", err);
            return res.status(400).json({ error: 'Error al subir la imagen' });
        }
        
        const { tipo } = req.body;
        if (!tipo || !req.file) {
            return res.status(400).json({ error: 'Faltan datos (imagen o tipo)' });
        }

        try {
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const clave = tipo === 'logo' ? 'logo_admin' : 'fondo_login';
            
            db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)').run(clave, base64Image);
            res.json({ success: true, mensaje: 'Imagen actualizada correctamente' });
        } catch (error) {
            console.error("Error DB:", error);
            res.status(500).json({ error: 'Error al guardar en la base de datos' });
        }
    });
});

// ============ ÓRDENES ============
router.get('/ordenes/pendientes', (req, res) => {
    const ordenes = db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM orden_items WHERE orden_id = o.id) as total_items FROM ordenes o WHERE o.estado = 'pendiente' ORDER BY o.creado_en DESC`).all();
    res.json(ordenes.map(o => ({ ...o, alerta_monto: o.ocr_monto !== null && Math.abs(o.total - o.ocr_monto) > 0.01, alerta_ocr: !!o.ocr_error })));
});
router.get('/ordenes', (req, res) => {
    const estado = req.query.estado;
    let sql = 'SELECT * FROM ordenes';
    const params = [];
    if (estado) { sql += ' WHERE estado = ?'; params.push(estado); }
    sql += ' ORDER BY creado_en DESC LIMIT 200';
    res.json(db.prepare(sql).all(...params));
});
router.get('/ordenes/:id', (req, res) => {
    const orden = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(req.params.id);
    if (!orden) return res.status(404).json({ error: 'No encontrada' });
    const items = db.prepare(`SELECT oi.*, p.nombre, p.imagen_base64 FROM orden_items oi JOIN productos p ON p.id = oi.producto_id WHERE oi.orden_id = ?`).all(orden.id);
    res.json({ ...orden, items });
});
router.post('/ordenes/:id/revisar', (req, res) => {
    const { accion, notas } = req.body || {};
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });
    const orden = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(req.params.id);
    if (!orden) return res.status(404).json({ error: 'No encontrada' });
    if (orden.estado !== 'pendiente') return res.status(400).json({ error: 'Ya fue revisada' });
    const nuevoEstado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
    const tx = db.transaction(() => {
        db.prepare('UPDATE ordenes SET estado = ?, notas_admin = ? WHERE id = ?').run(nuevoEstado, notas || null, orden.id);
        if (accion === 'aprobar') {
            const items = db.prepare('SELECT * FROM orden_items WHERE orden_id = ?').all(orden.id);
            const upd = db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?');
            for (const it of items) upd.run(it.cantidad, it.producto_id);
        }
    });
    tx();
    res.json({ success: true, nuevo_estado: nuevoEstado });
});

// ============ TICKETS ============
router.get('/tickets/pendientes', (req, res) => {
    const rows = db.prepare(`SELECT t.*, s.nombre as sorteo_nombre, s.precio_ticket FROM tickets t JOIN sorteos s ON s.id = t.sorteo_id WHERE t.estado_pago = 'pendiente' ORDER BY t.creado_en DESC`).all();
    res.json(rows.map(t => ({ ...t, alerta_monto: t.ocr_monto !== null && Math.abs(t.precio_ticket - t.ocr_monto) > 0.01, alerta_ocr: !!t.ocr_error })));
});
router.post('/tickets/:id/revisar', (req, res) => {
    const { accion, notas } = req.body || {};
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'No encontrado' });
    if (t.estado_pago !== 'pendiente') return res.status(400).json({ error: 'Ya fue revisado' });
    const nuevo = accion === 'aprobar' ? 'aprobado' : 'rechazado';
    db.prepare('UPDATE tickets SET estado_pago = ?, notas_admin = ? WHERE id = ?').run(nuevo, notas || null, t.id);
    res.json({ success: true, nuevo_estado: nuevo });
});

// ============ PRODUCTOS ============
router.get('/productos', (req, res) => { res.json(db.prepare('SELECT * FROM productos ORDER BY creado_en DESC').all()); });
router.post('/productos', (req, res) => {
    uploadProducto(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio, stock, categoria } = req.body;
        
        let imagen_path = null;
        if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;

        const r = db.prepare(`INSERT INTO productos (nombre, descripcion, precio, stock, imagen_base64, categoria) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(nombre, descripcion || null, parseFloat(precio), parseInt(stock) || 0, imagen_path, categoria || 'ropa_tipica');
        res.json({ success: true, id: r.lastInsertRowid });
    });
});
router.put('/productos/:id', (req, res) => {
    uploadProducto(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio, stock, categoria, activo } = req.body;
        const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
        if (!p) return res.status(404).json({ error: 'No encontrado' });
        
        let imagen_path = p.imagen_base64;
        if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;

        db.prepare(`UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, imagen_base64=?, categoria=?, activo=? WHERE id=?`)
            .run(nombre || p.nombre, descripcion ?? p.descripcion, precio ? parseFloat(precio) : p.precio, stock !== undefined ? parseInt(stock) : p.stock, imagen_path, categoria || p.categoria, activo !== undefined ? parseInt(activo) : p.activo, p.id);
        res.json({ success: true });
    });
});
router.delete('/productos/:id', (req, res) => { db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(req.params.id); res.json({ success: true }); });

// ============ SORTEOS ============
router.get('/sorteos', (req, res) => { res.json(db.prepare('SELECT * FROM sorteos ORDER BY creado_en DESC').all()); });
router.post('/sorteos', (req, res) => {
    uploadProducto(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio_ticket, fecha_sorteo, estado } = req.body;
        
        let imagen_path = null;
        if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;

        const r = db.prepare(`INSERT INTO sorteos (nombre, descripcion, precio_ticket, imagen_base64, fecha_sorteo, estado) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(nombre, descripcion || null, parseFloat(precio_ticket), imagen_path, fecha_sorteo, estado || 'activo');
        res.json({ success: true, id: r.lastInsertRowid });
    });
});
router.put('/sorteos/:id', (req, res) => {
    uploadProducto(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        const { nombre, descripcion, precio_ticket, fecha_sorteo, estado } = req.body;
        const s = db.prepare('SELECT * FROM sorteos WHERE id = ?').get(req.params.id);
        if (!s) return res.status(404).json({ error: 'No encontrado' });
        
        let imagen_path = s.imagen_base64;
        if (req.file) imagen_path = `/uploads/imagenes/${req.file.filename}`;

        db.prepare(`UPDATE sorteos SET nombre=?, descripcion=?, precio_ticket=?, imagen_base64=?, fecha_sorteo=?, estado=? WHERE id=?`)
            .run(nombre || s.nombre, descripcion ?? s.descripcion, precio_ticket ? parseFloat(precio_ticket) : s.precio_ticket, imagen_path, fecha_sorteo || s.fecha_sorteo, estado || s.estado, s.id);
        res.json({ success: true });
    });
});

// ⭐ NUEVA RUTA PARA ELIMINAR SORTEOS
router.delete('/sorteos/:id', (req, res) => {
    try {
        const sorteoId = req.params.id;
        
        // Iniciamos una transacción para borrar los tickets asociados primero y luego el sorteo
        const tx = db.transaction(() => {
            db.prepare('DELETE FROM tickets WHERE sorteo_id = ?').run(sorteoId);
            db.prepare('DELETE FROM sorteos WHERE id = ?').run(sorteoId);
        });
        
        tx();
        res.json({ success: true, mensaje: 'Sorteo y sus tickets eliminados correctamente' });
    } catch (error) {
        console.error("Error al eliminar sorteo:", error);
        res.status(500).json({ error: 'Error al eliminar el sorteo de la base de datos' });
    }
});

// ============ CARRUSEL ============
router.get('/carrusel', (req, res) => { res.json(db.prepare('SELECT * FROM carrusel ORDER BY orden ASC, id ASC').all()); });
router.post('/carrusel', (req, res) => {
    uploadProducto(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir una imagen' });
        const count = db.prepare('SELECT COUNT(*) as c FROM carrusel').get().c;
        if (count >= 5) return res.status(400).json({ error: 'El carrusel solo permite 5 imágenes.' });
        
        const imagen_path = `/uploads/imagenes/${req.file.filename}`;
        db.prepare('INSERT INTO carrusel (imagen_base64, orden) VALUES (?, ?)').run(imagen_path, count);
        res.json({ success: true });
    });
});
router.delete('/carrusel/:id', (req, res) => { db.prepare('DELETE FROM carrusel WHERE id = ?').run(req.params.id); res.json({ success: true }); });

module.exports = router;
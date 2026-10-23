const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAdmin);

router.get('/', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT id, nombre, email, rol, telefono, activo, ultimo_acceso, creado_en 
            FROM usuarios ORDER BY creado_en DESC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'SELECT id, nombre, email, rol, telefono, activo, ultimo_acceso, creado_en FROM usuarios WHERE id = ?',
            args: [req.params.id]
        });
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
    const { nombre, email, password, rol, telefono } = req.body || {};
    if (!nombre || !email || !password || !rol) {
        return res.status(400).json({ error: 'Nombre, email, contraseña y rol son obligatorios' });
    }
    if (!['admin', 'vendedor', 'cliente'].includes(rol)) {
        return res.status(400).json({ error: 'Rol inválido' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        const existe = await db.execute({ sql: 'SELECT id FROM usuarios WHERE email = ?', args: [email] });
        if (existe.rows.length > 0) return res.status(400).json({ error: 'Este email ya está registrado' });

        const hash = await bcrypt.hash(password, 10);
        const result = await db.execute({
            sql: `INSERT INTO usuarios (nombre, email, password_hash, rol, telefono) VALUES (?, ?, ?, ?, ?)`,
            args: [nombre, email, hash, rol, telefono || null]
        });

        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)',
            args: [req.user.userId, 'CREAR_USUARIO', `Creó usuario: ${email} (${rol})`, req.ip, ahora]
        });

        // ⭐ CORRECCIÓN BIGINT
        res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
    const { nombre, email, password, rol, telefono, activo } = req.body || {};
    const id = req.params.id;

    try {
        const uRes = await db.execute({ sql: 'SELECT * FROM usuarios WHERE id = ?', args: [id] });
        const u = uRes.rows[0];
        if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (u.id === req.user.userId && rol && rol !== 'admin') {
            return res.status(400).json({ error: 'No puedes cambiar tu propio rol de admin' });
        }
        if (rol && !['admin', 'vendedor', 'cliente'].includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }
        if (email && email !== u.email) {
            const existe = await db.execute({ sql: 'SELECT id FROM usuarios WHERE email = ? AND id != ?', args: [email, id] });
            if (existe.rows.length > 0) return res.status(400).json({ error: 'Este email ya está registrado' });
        }

        let password_hash = u.password_hash;
        if (password && password.length >= 6) {
            password_hash = await bcrypt.hash(password, 10);
        } else if (password && password.length < 6 && password.length > 0) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        await db.execute({
            sql: `UPDATE usuarios SET nombre=?, email=?, password_hash=?, rol=?, telefono=?, activo=? WHERE id=?`,
            args: [nombre || u.nombre, email || u.email, password_hash, rol || u.rol, telefono !== undefined ? telefono : u.telefono, activo !== undefined ? parseInt(activo) : u.activo, id]
        });

        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)',
            args: [req.user.userId, 'EDITAR_USUARIO', `Editó usuario ID ${id}`, req.ip, ahora]
        });

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/toggle-activo', async (req, res) => {
    try {
        const uRes = await db.execute({ sql: 'SELECT * FROM usuarios WHERE id = ?', args: [req.params.id] });
        const u = uRes.rows[0];
        if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (u.id === req.user.userId) {
            return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
        }

        const nuevo = u.activo ? 0 : 1;
        await db.execute({ sql: 'UPDATE usuarios SET activo = ? WHERE id = ?', args: [nuevo, req.params.id] });

        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)',
            args: [req.user.userId, nuevo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', `Usuario ID ${req.params.id}`, req.ip, ahora]
        });

        res.json({ success: true, activo: nuevo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        const uRes = await db.execute({ sql: 'SELECT * FROM usuarios WHERE id = ?', args: [req.params.id] });
        const u = uRes.rows[0];
        if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (u.id === req.user.userId) {
            return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
        }

        await db.execute({ sql: 'DELETE FROM usuarios WHERE id = ?', args: [req.params.id] });

        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)',
            args: [req.user.userId, 'ELIMINAR_USUARIO', `Eliminó usuario: ${u.email}`, req.ip, ahora]
        });

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/logs/actividad', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT l.*, u.nombre as usuario_nombre, u.email as usuario_email
            FROM logs_actividad l LEFT JOIN usuarios u ON u.id = l.usuario_id
            ORDER BY l.creado_en DESC LIMIT 200
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
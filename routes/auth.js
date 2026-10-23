const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const router = express.Router();

async function logActividad(usuarioId, accion, detalle, ip) {
    try {
        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: 'INSERT INTO logs_actividad (usuario_id, accion, detalle, ip, creado_en) VALUES (?, ?, ?, ?, ?)',
            args: [usuarioId, accion, detalle || null, ip || null, ahora]
        });
    } catch (e) { console.error("Error log:", e.message); }
}

function generarToken(user) {
    return jwt.sign(
        { userId: user.id, rol: user.rol, nombre: user.nombre, email: user.email },
        process.env.JWT_SECRET || 'dev_secret',
        { expiresIn: '8h' }
    );
}

router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    try {
        const result = await db.execute({
            sql: "SELECT * FROM usuarios WHERE email = ? AND activo = 1 AND rol IN ('admin','vendedor')",
            args: [email]
        });
        const user = result.rows[0];

        if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

        const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await db.execute({
            sql: "UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?",
            args: [ahora, user.id]
        });

        const token = generarToken(user);
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        logActividad(user.id, 'LOGIN', `Inicio de sesión: ${user.email}`, req.ip);

        const redirect = user.rol === 'admin' ? '/admin/dashboard.html' : '/admin/ordenes.html';
        res.json({ success: true, rol: user.rol, redirect });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

router.post('/admin/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

router.get('/me', (req, res) => {
    if (req.session?.userId) {
        return res.json({ 
            logged: true, 
            nombre: req.session.nombre, 
            email: req.session.email,
            rol: req.session.rol 
        });
    }
    res.json({ logged: false });
});

router.get('/admin/me', (req, res) => {
    if (req.session?.userId) {
        return res.json({ logged: true, nombre: req.session.nombre, rol: req.session.rol });
    }
    res.json({ logged: false });
});

module.exports = router;
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');
const router = express.Router();

router.post('/admin/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND rol = ?')
                   .get(email, 'admin');

    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    req.session.regenerate(err => {
        if (err) return res.status(500).json({ error: 'Error de sesión' });
        req.session.userId = user.id;
        req.session.rol = user.rol;
        req.session.nombre = user.nombre;
        res.json({ success: true, redirect: '/admin/dashboard.html' });
    });
});

router.post('/admin/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

router.get('/admin/me', (req, res) => {
    if (req.session?.userId) {
        return res.json({ logged: true, nombre: req.session.nombre, rol: req.session.rol });
    }
    res.json({ logged: false });
});

module.exports = router;
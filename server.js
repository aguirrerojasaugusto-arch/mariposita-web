require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initDB } = require('./database');

BigInt.prototype.toJSON = function() { return Number(this); };

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
    req.session = {}; 
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
            req.session.userId = decoded.userId;
            req.session.rol = decoded.rol;
            req.session.nombre = decoded.nombre;
            req.session.email = decoded.email;
        } catch (err) {
            res.clearCookie('token');
        }
    }
    next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api', require('./routes/productos')); 
app.use('/api', require('./routes/ordenes')); 
// ⭐ IMPORTANTE: sorteos.js maneja la ruta /tickets. 
app.use('/api', require('./routes/sorteos')); 
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin/usuarios', require('./routes/usuarios')); 
app.use('/api/admin', require('./routes/admin'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
    console.error(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'La imagen es demasiado pesada.' });
    }
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Error interno' });
    res.status(500).send('Error interno');
});

initDB().then(() => {
    app.listen(PORT, () => console.log(`\n🦋 Servidor en http://localhost:${PORT}`));
});
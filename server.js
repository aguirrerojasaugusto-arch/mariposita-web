require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const rateLimit = require('express-rate-limit'); // ⭐ 1. NUEVA LÍNEA
const { initDB } = require('./database');

// ⭐ 2. NUEVO BLOQUE DE SEGURIDAD (Evita arrancar sin clave secreta)
if (!process.env.JWT_SECRET) {
    console.error("❌ CRÍTICO: JWT_SECRET no está configurado en el .env");
    process.exit(1);
}

BigInt.prototype.toJSON = function() { return Number(this); };

const app = express();
const PORT = process.env.PORT || 3000;

// ⭐ 3. NUEVA LÍNEA (Para que funcionen las cookies seguras en producción)
app.set('trust proxy', 1);

// ⭐ 4. NUEVOS LIMITADORES (No afectan el uso normal, solo bloquean ataques masivos)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { error: 'Demasiados intentos. Inténtalo en 15 minutos.' }
});

const consultaLimiter = rateLimit({
    windowMs: 60 * 1000, 
    max: 30, 
    message: { error: 'Demasiadas búsquedas. Espera un minuto.' }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
    req.session = {}; 
    const token = req.cookies.token;
    if (token) {
        try {
            // ⭐ 5. ELIMINADO EL FALLBACK 'dev_secret'
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

// ⭐ 6. ACTIVACIÓN DE LOS LIMITADORES EN RUTAS ESPECÍFICAS
app.use('/api/auth/login', loginLimiter);
app.use('/api/consultar', consultaLimiter);

// --- A PARTIR DE AQUÍ TODO ES EXACTAMENTE IGUAL A TU CÓDIGO ORIGINAL ---
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
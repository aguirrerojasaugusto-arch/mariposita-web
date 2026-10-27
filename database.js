require('dotenv').config();
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// Crear carpetas de uploads si no existen
['uploads/productos', 'uploads/comprobantes', 'uploads/imagenes'].forEach(dir => {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Validar entorno
if (process.env.NODE_ENV === 'production' && !process.env.TURSO_DATABASE_URL) {
    console.error("❌ CRÍTICO: TURSO_DATABASE_URL no está definida en producción.");
    process.exit(1);
}

const db = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:mariposita.db',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

async function initDB() {
    console.log(`🔄 Inicializando base de datos (${process.env.NODE_ENV || 'development'})...`);
    
    await db.batch([
        `CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            rol TEXT DEFAULT 'vendedor' CHECK(rol IN ('admin','vendedor','cliente')),
            telefono TEXT,
            activo INTEGER DEFAULT 1,
            ultimo_acceso TEXT,
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        `CREATE TABLE IF NOT EXISTS logs_actividad (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER REFERENCES usuarios(id),
            accion TEXT NOT NULL,
            detalle TEXT,
            ip TEXT,
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        // ⭐ AQUÍ ESTÁ LA CORRECCIÓN: precio REAL (sin NOT NULL ni CHECK) ⭐
        `CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            precio REAL,
            stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
            imagen_base64 TEXT,
            categoria TEXT DEFAULT 'ropa_tipica',
            activo INTEGER DEFAULT 1,
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        `CREATE TABLE IF NOT EXISTS sorteos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            precio_ticket REAL NOT NULL CHECK(precio_ticket > 0),
            imagen_base64 TEXT,
            fecha_sorteo TEXT NOT NULL,
            estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo','cerrado','sorteado')),
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        `CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sorteo_id INTEGER NOT NULL REFERENCES sorteos(id),
            numero_ticket TEXT UNIQUE NOT NULL,
            cliente_nombre TEXT NOT NULL,
            cliente_dni TEXT,
            cliente_telefono TEXT,
            cliente_departamento TEXT,
            cantidad_tickets INTEGER DEFAULT 1,
            estado_pago TEXT DEFAULT 'pendiente' CHECK(estado_pago IN ('pendiente','aprobado','rechazado')),
            comprobante_base64 TEXT,
            hash_comprobante TEXT UNIQUE,
            ocr_monto REAL,
            ocr_fecha TEXT,
            ocr_operacion TEXT,
            ocr_confianza REAL,
            ocr_error TEXT,
            notas_admin TEXT,
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        `CREATE TABLE IF NOT EXISTS ordenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            cliente_nombre TEXT NOT NULL,
            cliente_dni TEXT,
            cliente_email TEXT,
            cliente_telefono TEXT NOT NULL,
            cliente_direccion TEXT NOT NULL,
            total REAL NOT NULL CHECK(total > 0),
            estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aprobado','rechazado','enviado')),
            comprobante_base64 TEXT,
            hash_comprobante TEXT UNIQUE,
            ocr_monto REAL,
            ocr_fecha TEXT,
            ocr_operacion TEXT,
            ocr_confianza REAL,
            ocr_error TEXT,
            notas_admin TEXT,
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        `CREATE TABLE IF NOT EXISTS orden_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orden_id INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
            producto_id INTEGER NOT NULL REFERENCES productos(id),
            cantidad INTEGER NOT NULL CHECK(cantidad > 0),
            precio_unitario REAL NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS carrusel (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imagen_base64 TEXT NOT NULL,
            orden INTEGER DEFAULT 0,
            creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo)`,
        `CREATE INDEX IF NOT EXISTS idx_ordenes_estado ON ordenes(estado)`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado_pago)`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_sorteo ON tickets(sorteo_id)`,
        `CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`
    ], "write");

    const configs = [
        ['numero_yape', '999 999 999'],
        ['numero_plin', '999 999 999'],
        ['nombre_titular', 'Artesanía Mariposita'],
        ['whatsapp', '999 999 999'],
        ['email_contacto', 'contacto@mariposita.pe'],
        ['logo_admin', null],
        ['fondo_login', null]
    ];
    for (const [clave, valor] of configs) {
        await db.execute({
            sql: 'INSERT OR IGNORE INTO configuracion (clave, valor) VALUES (?, ?)',
            args: [clave, valor]
        });
    }
    console.log("✅ Base de datos lista.");
}

module.exports = { db, initDB };
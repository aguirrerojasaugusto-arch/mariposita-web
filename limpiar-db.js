require('dotenv').config();
const { createClient } = require('@libsql/client');

async function limpiarYReconstruir() {
    console.log("⏳ Iniciando limpieza profunda y reconstrucción de tablas...\n");

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || 'file:mariposita.db',
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

    try {
        // 1. Desactivar restricciones para evitar conflictos
        await db.execute("PRAGMA foreign_keys = OFF;");

        // 2. Destruir las tablas problemáticas (incluyendo la temporal)
        console.log("🗑️  Destruyendo tablas antiguas...");
        const tablasABorrar = [
            'productos_vieja', 
            'orden_items', 
            'tickets', 
            'ordenes', 
            'sorteos', 
            'productos',
            'carrusel', 
            'logs_actividad'
        ];

        for (const tabla of tablasABorrar) {
            await db.execute(`DROP TABLE IF EXISTS ${tabla}`);
        }

        // 3. Recrear las tablas desde cero (Con el precio corregido)
        console.log("🏗️  Creando tablas nuevas y limpias...");
        await db.batch([
            `CREATE TABLE productos (
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
            `CREATE TABLE sorteos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                precio_ticket REAL NOT NULL CHECK(precio_ticket > 0),
                imagen_base64 TEXT,
                fecha_sorteo TEXT NOT NULL,
                estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo','cerrado','sorteado')),
                creado_en TEXT DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE TABLE tickets (
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
            `CREATE TABLE ordenes (
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
            `CREATE TABLE orden_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                orden_id INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
                producto_id INTEGER NOT NULL REFERENCES productos(id),
                cantidad INTEGER NOT NULL CHECK(cantidad > 0),
                precio_unitario REAL NOT NULL
            )`,
            `CREATE TABLE carrusel (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                imagen_base64 TEXT NOT NULL,
                orden INTEGER DEFAULT 0,
                creado_en TEXT DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE TABLE logs_actividad (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER REFERENCES usuarios(id),
                accion TEXT NOT NULL,
                detalle TEXT,
                ip TEXT,
                creado_en TEXT DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE INDEX idx_productos_activo ON productos(activo)`,
            `CREATE INDEX idx_ordenes_estado ON ordenes(estado)`,
            `CREATE INDEX idx_tickets_estado ON tickets(estado_pago)`,
            `CREATE INDEX idx_tickets_sorteo ON tickets(sorteo_id)`
        ], "write");

        // 4. Reactivar restricciones
        await db.execute("PRAGMA foreign_keys = ON;");

        // 5. Verificar resultados
        console.log("\n✅ LIMPIEZA PROFUNDA COMPLETADA CON ÉXITO.");
        
        const userRes = await db.execute("SELECT COUNT(*) as c FROM usuarios");
        const configRes = await db.execute("SELECT COUNT(*) as c FROM configuracion");

        console.log(`   👥 Usuarios conservados: ${userRes.rows[0].c}`);
        console.log(`   ⚙️  Configuraciones conservadas: ${configRes.rows[0].c}`);
        console.log(`   🛍️  Productos actuales: 0`);
        console.log(`   🎁 Sorteos actuales: 0`);
        
        console.log("\n🚀 Base de datos limpia y lista para producción.");

    } catch (error) {
        console.error("\n❌ Error durante la limpieza:", error.message);
        if (error.message.includes('fetch failed')) {
            console.error("💡 CONSEJO: Error de red. Revisa tu conexión a internet o tus credenciales en el .env");
        }
    }
}

limpiarYReconstruir();
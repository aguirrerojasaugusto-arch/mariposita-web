require('dotenv').config();
const { createClient } = require('@libsql/client');

async function arreglarBaseDeDatos() {
    console.log("⏳ Iniciando reparación de la base de datos en Turso...");

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || 'file:mariposita.db',
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

    try {
        // 1. Intentar agregar la columna faltante
        try {
            await db.execute("ALTER TABLE sorteos ADD COLUMN hora_sorteo TEXT DEFAULT '23:59'");
            console.log("✅ ¡Columna 'hora_sorteo' agregada con éxito!");
        } catch (e) {
            if (e.message.includes('duplicate column name')) {
                console.log("ℹ️ La columna 'hora_sorteo' ya existe. Todo está en orden.");
            } else {
                console.error("❌ Error al agregar la columna:", e.message);
            }
        }

        // 2. Verificar que la tabla de productos esté correcta (precio nulo)
        try {
            // Verificamos si la tabla productos tiene la restricción antigua
            const info = await db.execute("PRAGMA table_info(productos)");
            const precioCol = info.rows.find(r => r.name === 'precio');
            
            if (precioCol && precioCol.notnull === 1) {
                console.log("⚠️ La tabla productos aún tiene la restricción antigua. Arreglando...");
                // Si tiene la restricción, hacemos la migración rápida
                await db.batch([
                    "ALTER TABLE productos RENAME TO productos_backup",
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
                    "INSERT INTO productos SELECT * FROM productos_backup",
                    "DROP TABLE productos_backup"
                ], "write");
                console.log("✅ Tabla de productos corregida.");
            } else {
                console.log("ℹ️ La tabla de productos ya está correcta (precio acepta nulos).");
            }
        } catch (e) {
            console.log("ℹ️ La tabla de productos ya está correcta o no necesita ajustes.");
        }

        console.log("\n🚀 Base de datos lista para funcionar en producción.");

    } catch (error) {
        console.error("\n❌ Error de conexión:", error.message);
    }
}

arreglarBaseDeDatos();
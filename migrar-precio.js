require('dotenv').config();
const { db } = require('./database');

async function migrarPrecio() {
    console.log("⏳ Iniciando migración de la tabla productos...");
    try {
        // SQLite no permite modificar CHECK constraints con ALTER TABLE.
        // La solución segura es crear una tabla temporal, copiar los datos y renombrarla.
        
        await db.batch([
            // 1. Renombrar la tabla actual
            `ALTER TABLE productos RENAME TO productos_vieja`,
            
            // 2. Crear la nueva tabla SIN la restricción CHECK (precio puede ser NULL)
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
            
            // 3. Copiar los datos de la tabla vieja a la nueva
            `INSERT INTO productos (id, nombre, descripcion, precio, stock, imagen_base64, categoria, activo, creado_en)
             SELECT id, nombre, descripcion, precio, stock, imagen_base64, categoria, activo, creado_en FROM productos_vieja`,
             
            // 4. Eliminar la tabla vieja
            `DROP TABLE productos_vieja`
        ], "write");

        console.log("✅ Migración completada con éxito. La tabla 'productos' ahora acepta precios nulos.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error durante la migración:", error.message);
        process.exit(1);
    }
}

migrarPrecio();
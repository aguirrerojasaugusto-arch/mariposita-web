require('dotenv').config();
const { createClient } = require('@libsql/client');

async function limpiarBaseDeDatos() {
    console.log("⏳ Iniciando limpieza profunda de la base de datos...");

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || 'file:mariposita.db',
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

    try {
        // ⚠️ ORDEN IMPORTANTE: Se borran primero las tablas con relaciones (hijos) y al final los independientes
        const queries = [
            "DELETE FROM orden_items;",
            "DELETE FROM ordenes;",
            "DELETE FROM tickets;",
            "DELETE FROM ganadores;",
            "DELETE FROM sorteos;",
            "DELETE FROM productos;",
            "DELETE FROM carrusel;",
            "DELETE FROM logs_actividad;",
            // Reiniciar contadores de ID para que empiecen de 1 otra vez (Opcional)
            "DELETE FROM sqlite_sequence WHERE name IN ('orden_items', 'ordenes', 'tickets', 'ganadores', 'sorteos', 'productos', 'carrusel', 'logs_actividad');"
        ];

        for (const sql of queries) {
            await db.execute(sql);
            console.log(`✅ Ejecutado: ${sql.split(' ')[2]}`); // Muestra qué tabla se está limpiando
        }

        console.log("\n🎉 ¡Base de datos limpiada con éxito! Solo quedan los usuarios.");
        
        // Verificación rápida
        const check = await db.execute("SELECT (SELECT COUNT(*) FROM usuarios) as usuarios, (SELECT COUNT(*) FROM productos) as productos, (SELECT COUNT(*) FROM tickets) as tickets");
        console.log("📊 ESTADO ACTUAL:");
        console.log(`- Usuarios: ${check.rows[0].usuarios}`);
        console.log(`- Productos: ${check.rows[0].productos}`);
        console.log(`- Tickets: ${check.rows[0].tickets}`);

        process.exit(0);
    } catch (error) {
        console.error("❌ Error durante la limpieza:", error.message);
        process.exit(1);
    }
}

limpiarBaseDeDatos();
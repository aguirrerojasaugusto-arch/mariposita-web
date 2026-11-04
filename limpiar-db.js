require('dotenv').config();
const { createClient } = require('@libsql/client');

async function limpiarTodo() {
    console.log("⏳ Iniciando limpieza de la base de datos (conservando usuarios)...");

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || 'file:mariposita.db',
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

    try {
        // El orden importa para evitar errores de claves foráneas
        const tablas = [
            'orden_items',
            'ordenes',
            'tickets',
            'ganadores',
            'sorteos',
            'productos',
            'carrusel',
            'logs_actividad'
        ];

        for (const tabla of tablas) {
            await db.execute(`DELETE FROM ${tabla}`);
            console.log(`✅ Tabla '${tabla}' vaciada correctamente.`);
        }

        // Reiniciar los contadores de ID (Opcional, para que empiecen de 1)
        await db.execute(`DELETE FROM sqlite_sequence WHERE name IN (${tablas.map(t => `'${t}'`).join(',')})`);
        console.log("🔄 Contadores de ID reiniciados.");

        console.log("\n🎉 ¡Base de datos limpiada con éxito! Solo los usuarios han sido conservados.");
        
        // Verificación rápida
        const check = await db.execute("SELECT (SELECT COUNT(*) FROM usuarios) as usuarios, (SELECT COUNT(*) FROM productos) as productos, (SELECT COUNT(*) FROM tickets) as tickets");
        console.log(`📊 Usuarios conservados: ${check.rows[0].usuarios}`);
        console.log(`📊 Productos restantes: ${check.rows[0].productos}`);
        console.log(`📊 Tickets restantes: ${check.rows[0].tickets}`);

    } catch (error) {
        console.error("❌ Error durante la limpieza:", error.message);
    }
}

limpiarTodo();
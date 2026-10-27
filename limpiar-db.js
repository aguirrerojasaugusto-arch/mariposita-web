require('dotenv').config();
const { db, initDB } = require('./database');

async function limpiarBaseDeDatos() {
    console.log("⏳ Iniciando limpieza de la base de datos para PRODUCCIÓN...\n");

    try {
        // 1. Aseguramos que las tablas existan antes de limpiar
        await initDB();

        // 2. Vaciamos las tablas de pruebas
        console.log("🧹 Borrando datos de prueba (Productos, Sorteos, Tickets, Órdenes, Carrusel, Logs)...");
        
        await db.batch([
            "DELETE FROM orden_items",
            "DELETE FROM tickets",
            "DELETE FROM ordenes",
            "DELETE FROM sorteos",
            "DELETE FROM productos",
            "DELETE FROM carrusel",
            "DELETE FROM logs_actividad"
        ], "write");

        // 3. Reiniciamos los contadores AUTOINCREMENT (SQLite)
        // Esto hace que el próximo producto/ticket cree su ID desde 1
        console.log("🔄 Reiniciando contadores de ID (AUTOINCREMENT)...");
        
        await db.batch([
            "DELETE FROM sqlite_sequence WHERE name='productos'",
            "DELETE FROM sqlite_sequence WHERE name='sorteos'",
            "DELETE FROM sqlite_sequence WHERE name='tickets'",
            "DELETE FROM sqlite_sequence WHERE name='ordenes'",
            "DELETE FROM sqlite_sequence WHERE name='orden_items'",
            "DELETE FROM sqlite_sequence WHERE name='carrusel'",
            "DELETE FROM sqlite_sequence WHERE name='logs_actividad'"
        ], "write");

        // 4. Verificamos qué quedó en la base de datos
        console.log("\n✅ LIMPIEZA COMPLETADA CON ÉXITO.");
        
        const userRes = await db.execute("SELECT COUNT(*) as c FROM usuarios");
        const configRes = await db.execute("SELECT COUNT(*) as c FROM configuracion");
        const prodRes = await db.execute("SELECT COUNT(*) as c FROM productos");
        const sorteoRes = await db.execute("SELECT COUNT(*) as c FROM sorteos");

        console.log(`   👥 Usuarios conservados: ${userRes.rows[0].c}`);
        console.log(`   ⚙️  Configuraciones conservadas: ${configRes.rows[0].c}`);
        console.log(`   🛍️  Productos actuales: ${prodRes.rows[0].c}`);
        console.log(`   🎁 Sorteos actuales: ${sorteoRes.rows[0].c}`);
        
        console.log("\n🚀 Tu base de datos está lista para recibir datos reales.");
        
    } catch (error) {
        console.error("\n❌ Error durante la limpieza:", error.message);
    }
}

limpiarBaseDeDatos();
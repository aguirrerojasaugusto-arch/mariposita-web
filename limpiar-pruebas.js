require('dotenv').config();
const { db } = require('./database');

async function limpiarDatos() {
    console.log("⏳ Limpiando base de datos (Tickets y Órdenes)...");
    try {
        // 1. Borrar todos los registros de pruebas
        await db.execute("DELETE FROM tickets");
        await db.execute("DELETE FROM orden_items");
        await db.execute("DELETE FROM ordenes");
        await db.execute("DELETE FROM ganadores");
        
        // 2. Reiniciar los contadores (para que los IDs empiecen en 1 otra vez)
        try {
            await db.execute("DELETE FROM sqlite_sequence WHERE name IN ('tickets', 'ordenes', 'orden_items', 'ganadores')");
        } catch (e) {
            // Si la tabla no existe, ignoramos el error
        }

        console.log("✅ ¡Base de datos limpia! Ya puedes hacer pruebas con tus Yapes desde cero.");
    } catch (error) {
        console.error("❌ Error al limpiar:", error);
    }
    process.exit(0);
}

limpiarDatos();
require('dotenv').config();
const { createClient } = require('@libsql/client');

async function arreglarTabla() {
    console.log("⏳ Agregando la columna 'hora_sorteo' a la tabla sorteos...");
    
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || 'file:mariposita.db',
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

    try {
        // Agregamos la columna con un valor por defecto de '23:59'
        await db.execute("ALTER TABLE sorteos ADD COLUMN hora_sorteo TEXT DEFAULT '23:59'");
        console.log("✅ ¡Columna agregada con éxito! Ya puedes guardar sorteos con hora.");
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log("ℹ️ La columna 'hora_sorteo' ya existe. Todo está en orden.");
        } else {
            console.error("❌ Error:", e.message);
        }
    }
}

arreglarTabla();
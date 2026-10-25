require('dotenv').config();
const { db } = require('./database');

async function agregarColumnaHora() {
    try {
        console.log("⏳ Agregando columna 'hora_sorteo' a la tabla sorteos...");
        
        // Intentamos agregar la columna. Si ya existe, dará error y lo ignoramos.
        try {
            await db.execute("ALTER TABLE sorteos ADD COLUMN hora_sorteo TEXT DEFAULT '23:59'");
            console.log("✅ Columna 'hora_sorteo' agregada correctamente.");
        } catch (e) {
            console.log("ℹ️ La columna ya existía o hubo un detalle:", e.message);
        }
        
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

agregarColumnaHora();
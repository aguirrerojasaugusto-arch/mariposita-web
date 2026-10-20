const db = require('./database');

console.log("=========================================");
console.log("🔍 REVISANDO LOS ÚLTIMOS 10 TICKETS GUARDADOS");
console.log("=========================================\n");

try {
    // Consultamos los últimos 10 tickets para ver qué se guardó
    const tickets = db.prepare(`
        SELECT id, cliente_dni, cliente_nombre, cliente_telefono, cliente_departamento, creado_en 
        FROM tickets 
        ORDER BY creado_en DESC 
        LIMIT 10
    `).all();

    if (tickets.length === 0) {
        console.log("⚠️ No hay ningún ticket guardado en la base de datos todavía.");
    } else {
        // Mostramos los datos en formato de tabla para que sea fácil de leer
        console.table(tickets);
        
        console.log("\n=========================================");
        console.log("🕵️‍♂️ ANALIZANDO EL DNI 44946070");
        console.log("=========================================");
        
        const dniABuscar = '44946070';
        const encontrado = tickets.find(t => String(t.cliente_dni).includes(dniABuscar));
        
        if (encontrado) {
            console.log("✅ ¡El DNI SÍ está guardado en la base de datos!");
            console.log("Datos exactos:", encontrado);
        } else {
            console.log("❌ El DNI NO está en los últimos 10 tickets.");
            console.log("Posibles causas: La compra falló antes de guardar, o el DNI se guardó con un formato extraño.");
        }
    }
} catch (error) {
    console.error("❌ Error al conectar con la base de datos:", error.message);
}
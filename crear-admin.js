require('dotenv').config();
const bcrypt = require('bcrypt');
const { db } = require('./database');

async function crearAdmin() {
    try {
        const email = 'admin@mariposita.pe';
        const password = 'admin123';
        
        // Encriptar contraseña
        const hash = await bcrypt.hash(password, 10);
        
        // Insertar en Turso
        await db.execute({
            sql: `INSERT INTO usuarios (nombre, email, password_hash, rol, activo) 
                  VALUES (?, ?, ?, 'admin', 1)`,
            args: ['Administrador', email, hash]
        });
        
        console.log(`✅ Administrador creado con éxito.`);
        console.log(`   Email: ${email}`);
        console.log(`   Contraseña: ${password}`);
        process.exit(0);
    } catch (e) {
        console.error("❌ Error al crear admin:", e.message);
        process.exit(1);
    }
}

crearAdmin();
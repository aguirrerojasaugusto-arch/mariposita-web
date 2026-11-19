require('dotenv').config();
const { db } = require('./database');
const bcrypt = require('bcryptjs');

// ⭐ CAMBIA ESTOS DATOS POR LOS TUYOS ⭐
const email = 'tu-correo@ejemplo.com'; // El correo que ya está registrado
const nuevaPassword = 'TuNuevaContraseñaSegura123';

async function actualizar() {
    try {
        const hash = await bcrypt.hash(nuevaPassword, 10);
        const res = await db.execute({
            sql: 'UPDATE usuarios SET password_hash = ? WHERE email = ?',
            args: [hash, email]
        });
        
        if (res.rowsAffected > 0) {
            console.log(`✅ Contraseña actualizada con éxito para: ${email}`);
            console.log(`🔑 Nueva contraseña: ${nuevaPassword}`);
        } else {
            console.log(`❌ No se encontró ningún usuario con el correo: ${email}`);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}
actualizar();
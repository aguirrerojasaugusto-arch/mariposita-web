require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./database');

// Crear admin si no existe
const adminEmail = 'admin@mariposita.pe';
const adminPass = 'admin123';

const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(adminEmail);
if (!existe) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)')
      .run('Administrador', adminEmail, hash, 'admin');
    console.log(`✅ Admin creado: ${adminEmail} / ${adminPass}`);
} else {
    console.log('ℹ️ Admin ya existe');
}

// Productos de ejemplo
const prodCount = db.prepare('SELECT COUNT(*) as c FROM productos').get().c;
if (prodCount === 0) {
    // CORREGIDO: imagen_base64 en lugar de imagen_principal
    const insert = db.prepare(`INSERT INTO productos 
        (nombre, descripcion, precio, stock, imagen_base64, categoria) 
        VALUES (?, ?, ?, ?, ?, ?)`);
    insert.run('Pollera Huancavelica', 'Pollera bordada a mano con motivos andinos', 180, 10, null, 'ropa_tipica');
    insert.run('Chompa de Alpaca', 'Chompa tejida en alpaca 100%', 250, 8, null, 'ropa_tipica');
    insert.run('Montera Tradicional', 'Montera con bordados típicos', 90, 15, null, 'accesorio');
    insert.run('Faja Bordada', 'Faja tejida con iconografía andina', 65, 20, null, 'accesorio');
    console.log('✅ Productos de ejemplo creados');
}

// Sorteo de ejemplo
const sortCount = db.prepare('SELECT COUNT(*) as c FROM sorteos').get().c;
if (sortCount === 0) {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + 1);
    const fechaStr = fecha.toISOString().split('T')[0];
    db.prepare(`INSERT INTO sorteos (nombre, descripcion, precio_ticket, fecha_sorteo, estado) 
                VALUES (?, ?, ?, ?, 'activo')`)
      .run('Sorteo Vestido Andino Premium', 'Hermoso vestido bordado a mano', 10, fechaStr);
    console.log('✅ Sorteo de ejemplo creado');
}

console.log('\n🎉 Seed completado. Ejecuta: npm start');
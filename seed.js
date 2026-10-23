require('dotenv').config();
const bcrypt = require('bcrypt');
const { db, initDB } = require('./database');

async function seed() {
    await initDB();

    const adminEmail = 'admin@mariposita.pe';
    const adminPass = 'admin123';

    try {
        const res = await db.execute({ sql: 'SELECT id FROM usuarios WHERE email = ?', args: [adminEmail] });

        if (res.rows.length === 0) {
            const hash = bcrypt.hashSync(adminPass, 10);
            await db.execute({ sql: 'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)', args: ['Administrador', adminEmail, hash, 'admin'] });
            console.log(`✅ Admin creado: ${adminEmail} / ${adminPass}`);
        } else {
            console.log('ℹ️ Admin ya existe');
        }

        const prodRes = await db.execute('SELECT COUNT(*) as c FROM productos');
        if (prodRes.rows[0].c === 0) {
            const insert = 'INSERT INTO productos (nombre, descripcion, precio, stock, imagen_base64, categoria) VALUES (?, ?, ?, ?, ?, ?)';
            await db.execute({ sql: insert, args: ['Pollera Huancavelica', 'Pollera bordada a mano con motivos andinos', 180, 10, null, 'ropa_tipica'] });
            await db.execute({ sql: insert, args: ['Chompa de Alpaca', 'Chompa tejida en alpaca 100%', 250, 8, null, 'ropa_tipica'] });
            await db.execute({ sql: insert, args: ['Montera Tradicional', 'Montera con bordados típicos', 90, 15, null, 'accesorio'] });
            await db.execute({ sql: insert, args: ['Faja Bordada', 'Faja tejida con iconografía andina', 65, 20, null, 'accesorio'] });
            console.log('✅ Productos de ejemplo creados');
        }

        const sortRes = await db.execute('SELECT COUNT(*) as c FROM sorteos');
        if (sortRes.rows[0].c === 0) {
            const fecha = new Date();
            fecha.setMonth(fecha.getMonth() + 1);
            const fechaStr = fecha.toISOString().split('T')[0];
            await db.execute({ sql: `INSERT INTO sorteos (nombre, descripcion, precio_ticket, fecha_sorteo, estado) VALUES (?, ?, ?, ?, 'activo')`, args: ['Sorteo Vestido Andino Premium', 'Hermoso vestido bordado a mano', 10, fechaStr] });
            console.log('✅ Sorteo de ejemplo creado');
        }

        console.log('\n🎉 Seed completado.');
    } catch (err) {
        console.error("❌ Error en seed:", err);
    }
}

seed();
const express = require('express');
const { db } = require('../database');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get('/productos', async (req, res) => {
    try {
        const result = await db.execute('SELECT id, nombre, descripcion, precio, stock, imagen_base64, categoria FROM productos WHERE activo = 1 ORDER BY creado_en DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

router.get('/productos/:id', async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'SELECT * FROM productos WHERE id = ? AND activo = 1',
            args: [req.params.id]
        });
        const p = result.rows[0];
        if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json(p);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el producto' });
    }
});

router.get('/sorteos', async (req, res) => {
    try {
        const result = await db.execute("SELECT id, nombre, descripcion, precio_ticket, imagen_base64, fecha_sorteo FROM sorteos WHERE estado = 'activo' ORDER BY fecha_sorteo ASC");
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener sorteos' });
    }
});

router.get('/config-publica', async (req, res) => {
    try {
        const keys = ['numero_yape', 'numero_plin', 'nombre_titular', 'whatsapp', 'email_contacto', 'logo_admin', 'fondo_login'];
        const placeholders = keys.map(() => '?').join(',');
        const result = await db.execute({
            sql: `SELECT clave, valor FROM configuracion WHERE clave IN (${placeholders})`,
            args: keys
        });
        const obj = {};
        result.rows.forEach(r => obj[r.clave] = r.valor);
        res.json(obj);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.get('/carrusel', async (req, res) => {
    try {
        const result = await db.execute('SELECT id, imagen_base64 FROM carrusel ORDER BY orden ASC, id ASC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener carrusel' });
    }
});

router.get('/buscar-dni/:dni', async (req, res) => {
    const dni = req.params.dni;
    if (!dni) return res.status(400).json({ error: 'DNI requerido' });

    try {
        const result = await db.execute({
            sql: `SELECT cliente_nombre as nombre, cliente_telefono as telefono, cliente_departamento as departamento 
                  FROM tickets WHERE cliente_dni = ? ORDER BY creado_en DESC LIMIT 1`,
            args: [dni]
        });
        const cliente = result.rows[0];
        if (cliente) res.json({ encontrado: true, cliente });
        else res.json({ encontrado: false, cliente: null });
    } catch (error) {
        console.error("Error al buscar DNI:", error);
        res.status(500).json({ error: 'Error interno al buscar el DNI' });
    }
});

router.get('/consultar', async (req, res) => {
    const query = req.query.query;
    if (!query) return res.status(400).json({ error: 'Debes ingresar un DNI o Teléfono' });

    try {
        const ordenesRes = await db.execute({
            sql: `SELECT codigo, total, estado, creado_en, cliente_direccion, notas_admin 
                  FROM ordenes WHERE cliente_telefono LIKE ? OR cliente_nombre LIKE ? ORDER BY creado_en DESC`,
            args: [`%${query}%`, `%${query}%`]
        });

        const ticketsRes = await db.execute({
            sql: `SELECT t.id, t.numero_ticket, t.estado_pago, t.creado_en, t.notas_admin, t.cliente_nombre, 
                         s.nombre as sorteo_nombre, s.fecha_sorteo
                  FROM tickets t JOIN sorteos s ON s.id = t.sorteo_id
                  WHERE t.cliente_telefono LIKE ? OR t.cliente_dni LIKE ? OR t.cliente_nombre LIKE ? 
                  ORDER BY t.creado_en DESC`,
            args: [`%${query}%`, `%${query}%`, `%${query}%`]
        });

        res.json({ ordenes: ordenesRes.rows, tickets: ticketsRes.rows });
    } catch (error) {
        console.error("Error en consultar:", error);
        res.status(500).json({ error: 'Error al consultar' });
    }
});

router.post('/tickets', upload.single('comprobante'), async (req, res) => {
    try {
        const { sorteo_id, dni, nombre, telefono, departamento, cantidad } = req.body;
        
        if (!req.file) return res.status(400).json({ error: 'El comprobante es obligatorio' });
        if (!sorteo_id || !nombre || !telefono || !departamento) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        const sorteoRes = await db.execute({
            sql: "SELECT precio_ticket FROM sorteos WHERE id = ? AND estado = 'activo'",
            args: [sorteo_id]
        });
        const sorteo = sorteoRes.rows[0];
        if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado o no está activo' });

        const configRes = await db.execute("SELECT valor FROM configuracion WHERE clave = 'nombre_titular'");
        const nombreTitular = configRes.rows[0] ? configRes.rows[0].valor : 'Artesanía Mariposita';

        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const duplicadoRes = await db.execute({
            sql: 'SELECT id FROM tickets WHERE hash_comprobante = ?',
            args: [hash]
        });
        if (duplicadoRes.rows.length > 0) {
            return res.status(400).json({ error: '⚠️ Este comprobante ya fue utilizado en otra compra. No se permiten imágenes duplicadas.' });
        }

        const cantTickets = parseInt(cantidad) || 1;
        const montoEsperado = sorteo.precio_ticket * cantTickets;

        console.log("⏳ Iniciando lectura de imagen (OCR)...");
        let textoImagen = "";
        try {
            const processedImage = await sharp(req.file.buffer)
                .resize(1200, null, { withoutEnlargement: true })
                .grayscale()
                .threshold(180)
                .toBuffer();

            const worker = await createWorker('spa'); 
            const { data: { text } } = await worker.recognize(processedImage);
            await worker.terminate();

            textoImagen = text;
        } catch (ocrError) {
            console.error("Error crítico en OCR:", ocrError);
            return res.status(400).json({ error: 'No se pudo procesar la imagen. Asegúrate de subir una captura clara y recortada de Yape o Plin.' });
        }

        const textoLimpio = textoImagen.replace(/[^a-zA-Z0-9]/g, ''); 
        const montoStr = montoEsperado.toString(); 
        const montoConCeros = montoEsperado.toFixed(2).replace('.', ''); 

        const validoMonto = textoLimpio.includes(montoStr) || textoLimpio.includes(montoConCeros);
        const palabrasTitular = nombreTitular.split(' ').filter(p => p.length > 3);
        const validoTitular = palabrasTitular.every(palabra => textoImagen.toLowerCase().includes(palabra.toLowerCase()));

        if (!validoMonto || !validoTitular) {
            let reporte = "⚠️ **RESULTADO DE LA VALIDACIÓN** ⚠️\n\n";
            if (validoMonto) reporte += `✅ Monto correcto (S/ ${montoEsperado})\n`;
            else reporte += `❌ Monto incorrecto. No se encontró S/ ${montoEsperado} en la imagen.\n`;

            if (validoTitular) reporte += `✅ Titular correcto (${nombreTitular})\n`;
            else reporte += `❌ Titular incorrecto. El comprobante no muestra el nombre "${nombreTitular}".\n`;

            return res.status(400).json({ error: reporte });
        }

        const numeroTicket = 'TKT-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        await db.execute({
            sql: `INSERT INTO tickets 
                  (sorteo_id, numero_ticket, cliente_dni, cliente_nombre, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, creado_en) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', datetime('now', 'localtime'))`,
            args: [sorteo_id, numeroTicket, dni || null, nombre, telefono, departamento, cantTickets, base64Image, hash]
        });

        res.json({ success: true, numero_ticket: numeroTicket, mensaje: 'Ticket reservado con éxito' });

    } catch (error) {
        console.error("Error DB al procesar ticket:", error);
        res.status(500).json({ error: 'Error interno: ' + error.message });
    }
});

module.exports = router;
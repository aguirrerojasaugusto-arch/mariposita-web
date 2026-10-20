const express = require('express');
const db = require('../database');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

// ==========================================
// CONFIGURACIÓN DE MULTER (EN MEMORIA)
// ==========================================
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// RUTAS GET (PÚBLICAS)
// ==========================================

router.get('/productos', (req, res) => {
    try {
        const productos = db.prepare(
            'SELECT id, nombre, descripcion, precio, stock, imagen_base64, categoria FROM productos WHERE activo = 1 ORDER BY creado_en DESC'
        ).all();
        res.json(productos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

router.get('/productos/:id', (req, res) => {
    try {
        const p = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(req.params.id);
        if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json(p);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el producto' });
    }
});

router.get('/sorteos', (req, res) => {
    try {
        const sorteos = db.prepare(
            "SELECT id, nombre, descripcion, precio_ticket, imagen_base64, fecha_sorteo FROM sorteos WHERE estado = 'activo' ORDER BY fecha_sorteo ASC"
        ).all();
        res.json(sorteos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener sorteos' });
    }
});

router.get('/config-publica', (req, res) => {
    try {
        const keys = ['numero_yape', 'numero_plin', 'nombre_titular', 'whatsapp', 'email_contacto', 'logo_admin', 'fondo_login'];
        const rows = db.prepare(`SELECT clave, valor FROM configuracion WHERE clave IN (${keys.map(() => '?').join(',')})`).all(...keys);
        const obj = {};
        rows.forEach(r => obj[r.clave] = r.valor);
        res.json(obj);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.get('/carrusel', (req, res) => {
    try {
        const imagenes = db.prepare('SELECT id, imagen_base64 FROM carrusel ORDER BY orden ASC, id ASC').all();
        res.json(imagenes);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener carrusel' });
    }
});

router.get('/buscar-dni/:dni', (req, res) => {
    const dni = req.params.dni;
    if (!dni) return res.status(400).json({ error: 'DNI requerido' });

    try {
        const cliente = db.prepare(`
            SELECT cliente_nombre as nombre, cliente_telefono as telefono, cliente_departamento as departamento 
            FROM tickets 
            WHERE cliente_dni = ? 
            ORDER BY creado_en DESC LIMIT 1
        `).get(dni);

        if (cliente) {
            res.json({ encontrado: true, cliente });
        } else {
            res.json({ encontrado: false, cliente: null });
        }
    } catch (error) {
        console.error("Error al buscar DNI:", error);
        res.status(500).json({ error: 'Error interno al buscar el DNI' });
    }
});

router.get('/consultar', (req, res) => {
    const query = req.query.query;
    if (!query) return res.status(400).json({ error: 'Debes ingresar un DNI o Teléfono' });

    try {
        const ordenes = db.prepare(`
            SELECT codigo, total, estado, creado_en, cliente_direccion, notas_admin 
            FROM ordenes WHERE cliente_telefono LIKE ? OR cliente_nombre LIKE ? ORDER BY creado_en DESC
        `).all(`%${query}%`, `%${query}%`);

        const tickets = db.prepare(`
            SELECT 
                t.id, t.numero_ticket, t.estado_pago, t.creado_en, t.notas_admin, t.cliente_nombre, 
                s.nombre as sorteo_nombre, s.fecha_sorteo
            FROM tickets t 
            JOIN sorteos s ON s.id = t.sorteo_id
            WHERE t.cliente_telefono LIKE ? OR t.cliente_dni LIKE ? OR t.cliente_nombre LIKE ? 
            ORDER BY t.creado_en DESC
        `).all(`%${query}%`, `%${query}%`, `%${query}%`);

        res.json({ ordenes, tickets });
    } catch (error) {
        console.error("Error en consultar:", error);
        res.status(500).json({ error: 'Error al consultar' });
    }
});


// ==========================================
// RUTAS POST (VALIDACIÓN ESTRICTA)
// ==========================================

router.post('/tickets', upload.single('comprobante'), async (req, res) => {
    try {
        const { sorteo_id, dni, nombre, telefono, departamento, cantidad } = req.body;
        
        if (!req.file) return res.status(400).json({ error: 'El comprobante es obligatorio' });
        if (!sorteo_id || !nombre || !telefono || !departamento) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        // 1. DATOS DEL SORTEO Y CONFIGURACIÓN
        const sorteo = db.prepare("SELECT precio_ticket FROM sorteos WHERE id = ? AND estado = 'activo'").get(sorteo_id);
        if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado o no está activo' });

        const configTitular = db.prepare("SELECT valor FROM configuracion WHERE clave = 'nombre_titular'").get();
        const nombreTitular = configTitular ? configTitular.valor : 'Artesanía Mariposita';

        // 2. VALIDAR DUPLICADOS (HASH)
        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const duplicado = db.prepare('SELECT id FROM tickets WHERE hash_comprobante = ?').get(hash);
        if (duplicado) {
            return res.status(400).json({ error: '⚠️ Este comprobante ya fue utilizado en otra compra. No se permiten imágenes duplicadas.' });
        }

        const cantTickets = parseInt(cantidad) || 1;
        const montoEsperado = sorteo.precio_ticket * cantTickets;

        // 3. LECTURA DE IMAGEN (OCR)
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
            console.log("Texto detectado en la imagen:", textoImagen);
        } catch (ocrError) {
            console.error("Error crítico en OCR:", ocrError);
            return res.status(400).json({ error: 'No se pudo procesar la imagen. Asegúrate de subir una captura clara y recortada de Yape o Plin.' });
        }

        // 4. VALIDACIONES (SOLO MONTO Y TITULAR)
        const textoLimpio = textoImagen.replace(/[^a-zA-Z0-9]/g, ''); 
        
        // Formateamos el monto (15.00 -> "15", "1500")
        const montoStr = montoEsperado.toString(); 
        const montoConCeros = montoEsperado.toFixed(2).replace('.', ''); // "1500"

        // A) Validación de Monto (Buscamos el número en el texto)
        const validoMonto = textoLimpio.includes(montoStr) || 
                            textoLimpio.includes(montoConCeros);

        // B) Validación de Nombre del Titular
        const palabrasTitular = nombreTitular.split(' ').filter(p => p.length > 3);
        const validoTitular = palabrasTitular.every(palabra => textoImagen.toLowerCase().includes(palabra.toLowerCase()));

        // ⭐ SE ELIMINÓ POR COMPLETO LA VALIDACIÓN DE FECHA (Ya no existe el código que calculaba los minutos)

        // 5. REPORTE DE ERRORES (Solo si falla monto o titular)
        if (!validoMonto || !validoTitular) {
            let reporte = "⚠️ **RESULTADO DE LA VALIDACIÓN** ⚠️\n\n";
            
            if (validoMonto) reporte += `✅ Monto correcto (S/ ${montoEsperado})\n`;
            else reporte += `❌ Monto incorrecto. No se encontró S/ ${montoEsperado} en la imagen.\n`;

            if (validoTitular) reporte += `✅ Titular correcto (${nombreTitular})\n`;
            else reporte += `❌ Titular incorrecto. El comprobante no muestra el nombre "${nombreTitular}".\n`;

            reporte += "\n👉 **Asegúrate de que la imagen muestre claramente el monto y el nombre del destinatario.**";
            return res.status(400).json({ error: reporte });
        }

        // 6. SI TODO ES CORRECTO, GUARDAMOS
        const numeroTicket = 'TKT-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        const stmt = db.prepare(`
            INSERT INTO tickets 
            (sorteo_id, numero_ticket, cliente_dni, cliente_nombre, cliente_telefono, cliente_departamento, cantidad_tickets, comprobante_base64, hash_comprobante, estado_pago, creado_en) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', datetime('now', 'localtime'))
        `);
        
        stmt.run(sorteo_id, numeroTicket, dni || null, nombre, telefono, departamento, cantTickets, base64Image, hash);

        res.json({ success: true, numero_ticket: numeroTicket, mensaje: 'Ticket reservado con éxito' });

    } catch (error) {
        console.error("Error DB al procesar ticket:", error);
        res.status(500).json({ error: 'Error interno: ' + error.message });
    }
});

module.exports = router;
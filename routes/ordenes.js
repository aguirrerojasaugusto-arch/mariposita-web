const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { uploadComprobante } = require('../middleware/upload');
// ⭐ USAMOS LOS NUEVOS ARCHIVOS EXCLUSIVOS PARA ÓRDENES
const { validarImagenOrden } = require('../services/validarComprobanteOrdenes');
const { extraerDatosOrden } = require('../services/ocr_ordenes');
const router = express.Router();

router.get('/buscar-cliente/:dni', (req, res) => {
    const dni = req.params.dni;
    if (!dni) return res.status(400).json({ error: 'DNI requerido' });

    try {
        const cliente = db.prepare(`
            SELECT cliente_nombre as nombre, cliente_telefono as telefono, cliente_direccion as direccion 
            FROM ordenes 
            WHERE cliente_dni = ? 
            ORDER BY creado_en DESC LIMIT 1
        `).get(dni);

        if (cliente) {
            res.json({ encontrado: true, cliente });
        } else {
            res.json({ encontrado: false, cliente: null });
        }
    } catch (error) {
        console.error("Error al buscar cliente:", error);
        res.status(500).json({ error: 'Error interno al buscar el DNI' });
    }
});

router.post('/ordenes', (req, res) => {
    uploadComprobante(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Debes subir el comprobante' });

        try {
            // 1. VALIDACIÓN VISUAL FLEXIBLE (Solo vertical y con fondo blanco)
            const validacion = await validarImagenOrden(req.file.buffer);
            if (!validacion.valido) return res.status(400).json({ error: validacion.error });

            const { nombre, telefono, direccion, items, dni } = req.body;
            if (!nombre || !telefono || !direccion || !dni) {
                return res.status(400).json({ error: 'Faltan datos personales (Nombre, DNI, Teléfono o Dirección)' });
            }

            let itemsParsed;
            try { itemsParsed = JSON.parse(items); } catch { itemsParsed = null; }
            if (!Array.isArray(itemsParsed) || itemsParsed.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

            let total = 0;
            const validItems = [];
            for (const it of itemsParsed) {
                const prod = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(it.producto_id);
                if (!prod) return res.status(400).json({ error: 'Producto no encontrado' });
                const cant = parseInt(it.cantidad, 10);
                if (!cant || cant < 1) return res.status(400).json({ error: 'Cantidad inválida' });
                if (prod.stock < cant) return res.status(400).json({ error: `Stock insuficiente: ${prod.nombre}` });
                total += prod.precio * cant;
                validItems.push({ producto_id: prod.id, cantidad: cant, precio: prod.precio });
            }

            // 2. PROCESAR OCR (Buscando específicamente el destinatario)
            const ocr = await extraerDatosOrden(req.file.buffer);
            
            if (ocr.error_ocr) {
                console.warn("Fallo en OCR (Ordenes):", ocr.error_ocr);
            }

            // ⭐ VALIDACIÓN ÚNICA Y FLEXIBLE: EL NOMBRE
            // Si la IA no leyó nada de texto en absoluto, ahí sí rechazamos.
            if (!ocr.destinatario && !ocr.texto_completo) {
                return res.status(400).json({ 
                    error: 'No pudimos leer el texto del comprobante. Asegúrate de que la imagen sea clara y no esté borrosa.' 
                });
            }

            const nombreParaValidar = nombre.trim().toLowerCase();
            // Filtramos palabras muy cortas (como "de", "la") para validar mejor
            const palabrasNombre = nombreParaValidar.split(' ').filter(p => p.length > 2);
            
            // Unimos lo que leyó la IA para buscar
            const textoAValidar = `${ocr.destinatario || ''} ${ocr.texto_completo || ''}`.toLowerCase();
            
            // Verificamos si al menos una palabra del nombre ingresado está en el comprobante
            const nombreCoincide = palabrasNombre.some(palabra => textoAValidar.includes(palabra));

            if (!nombreCoincide) {
                return res.status(400).json({ 
                    error: `El nombre ingresado ("${nombre}") no coincide con el destinatario que figura en el comprobante.` 
                });
            }

            // 3. VALIDAR ANTI-DUPLICADO (Por hash de imagen)
            const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            if (db.prepare('SELECT id FROM tickets WHERE hash_comprobante = ?').get(hash) || 
                db.prepare('SELECT id FROM ordenes WHERE hash_comprobante = ?').get(hash)) {
                return res.status(400).json({ error: '⚠️ Esta imagen ya fue utilizada.' });
            }

            // 4. GUARDAR EN LA BASE DE DATOS
            const year = new Date().getFullYear();
            const count = db.prepare('SELECT COUNT(*) as c FROM ordenes').get().c + 1;
            const codigo = `MAR-${year}-${String(count).padStart(4, '0')}`;
            const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

            const insert = db.prepare(`
                INSERT INTO ordenes (codigo, cliente_nombre, cliente_dni, cliente_email, cliente_telefono, cliente_direccion,
                    total, comprobante_base64, hash_comprobante, estado, ocr_monto, ocr_fecha, ocr_operacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)
            `);
            
            // Guardamos null en montos/fechas ya que no los validamos aquí
            const result = insert.run(codigo, nombre, dni, null, telefono, direccion,
                total, base64Image, hash, null, null, null);

            const insertItem = db.prepare('INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)');
            for (const it of validItems) {
                insertItem.run(result.lastInsertRowid, it.producto_id, it.cantidad, it.precio);
            }

            res.json({
                success: true, codigo, total,
                mensaje: 'Orden recibida correctamente.'
            });
        } catch (e) {
            console.error("Error procesando orden:", e);
            res.status(500).json({ error: 'Error interno al procesar la orden. Intenta de nuevo.' });
        }
    });
});

module.exports = router;
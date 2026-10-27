const express = require('express');
const { db } = require('../database');
const router = express.Router();

router.get('/productos', async (req, res) => {
    try {
        const result = await db.execute('SELECT id, nombre, descripcion, precio, stock, imagen_base64, categoria FROM productos WHERE activo = 1 ORDER BY creado_en DESC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener productos' }); }
});

router.get('/productos/:id', async (req, res) => {
    try {
        const result = await db.execute({ sql: 'SELECT * FROM productos WHERE id = ? AND activo = 1', args: [req.params.id] });
        const p = result.rows[0];
        if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json(p);
    } catch (error) { res.status(500).json({ error: 'Error al obtener el producto' }); }
});

router.get('/sorteos', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM sorteos WHERE estado = 'activo' ORDER BY fecha_sorteo ASC");
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener sorteos' }); }
});

router.get('/config-publica', async (req, res) => {
    try {
        const keys = [
            'numero_yape', 'numero_plin', 'nombre_titular', 'whatsapp', 
            'email_contacto', 'telefono_contacto', 'ubicacion', 'logo_admin', 'fondo_login', 'flyer_inicio'
        ];
        const placeholders = keys.map(() => '?').join(',');
        const result = await db.execute({
            sql: `SELECT clave, valor FROM configuracion WHERE clave IN (${placeholders})`,
            args: keys
        });
        const obj = {};
        result.rows.forEach(r => obj[r.clave] = r.valor);
        res.json(obj);
    } catch (error) { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

router.get('/carrusel', async (req, res) => {
    try {
        const result = await db.execute('SELECT id, imagen_base64 FROM carrusel ORDER BY orden ASC, id ASC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener carrusel' }); }
});

router.get('/buscar-dni/:dni', async (req, res) => {
    const dni = req.params.dni;
    if (!dni) return res.status(400).json({ error: 'DNI requerido' });
    try {
        const result = await db.execute({
            sql: `SELECT cliente_nombre as nombre, cliente_telefono as telefono, cliente_departamento as departamento FROM tickets WHERE cliente_dni = ? ORDER BY creado_en DESC LIMIT 1`,
            args: [dni]
        });
        const cliente = result.rows[0];
        if (cliente) res.json({ encontrado: true, cliente });
        else res.json({ encontrado: false, cliente: null });
    } catch (error) { res.status(500).json({ error: 'Error interno al buscar el DNI' }); }
});

router.get('/consultar', async (req, res) => {
    const query = req.query.query;
    if (!query) return res.status(400).json({ error: 'Debes ingresar un DNI o Teléfono' });
    try {
        const ordenesRes = await db.execute({
            sql: `SELECT codigo, total, estado, creado_en, cliente_direccion, notas_admin FROM ordenes WHERE cliente_telefono LIKE ? OR cliente_nombre LIKE ? ORDER BY creado_en DESC`,
            args: [`%${query}%`, `%${query}%`]
        });
        
        // ⭐ MODIFICACIÓN: Solo traemos tickets con estado_pago = 'aprobado' ⭐
        const ticketsRes = await db.execute({
            sql: `SELECT t.id, t.numero_ticket, t.creado_en, t.cliente_nombre, 
                         s.nombre as sorteo_nombre, s.fecha_sorteo 
                  FROM tickets t JOIN sorteos s ON s.id = t.sorteo_id 
                  WHERE (t.cliente_telefono LIKE ? OR t.cliente_dni LIKE ? OR t.cliente_nombre LIKE ?) 
                  AND t.estado_pago = 'aprobado'
                  ORDER BY t.creado_en DESC`,
            args: [`%${query}%`, `%${query}%`, `%${query}%`]
        });
        
        res.json({ ordenes: ordenesRes.rows, tickets: ticketsRes.rows });
    } catch (error) { res.status(500).json({ error: 'Error al consultar' }); }
});

module.exports = router;
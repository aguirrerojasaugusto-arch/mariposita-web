const express = require('express');
const { db } = require('../database');
const router = express.Router();

// ⭐ ============ NUEVA RUTA LIMPIA PARA CONSULTAR ============ ⭐
router.get('/consultar', async (req, res) => {
    const query = req.query.query;

    if (!query) {
        return res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
    }

    // ⭐ FORZAMOS AL NAVEGADOR A NO GUARDAR EN CACHÉ ⭐
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        // ⭐ BUSCAMOS DIRECTAMENTE EN TURSO CON MODO ESCRITURA ⭐
        const ordenesRes = await db.execute({
            sql: `SELECT * FROM ordenes WHERE cliente_dni = ? OR cliente_telefono = ? ORDER BY creado_en DESC`,
            args: [query, query],
            mode: "write"
        });

        // ⭐ BÚSQUEDA MEJORADA DE TICKETS ⭐
        const ticketsRes = await db.execute({
            sql: `SELECT t.*, s.nombre as sorteo_nombre 
                  FROM tickets t 
                  JOIN sorteos s ON s.id = t.sorteo_id 
                  WHERE (t.cliente_dni = ? OR t.cliente_telefono = ? OR t.cliente_nombre LIKE ?) 
                  ORDER BY t.id DESC`,
            args: [query, query, `%${query}%`],
            mode: "write"
        });

        // ⭐ LOG DE VERIFICACIÓN EN CONSOLA DE RENDER ⭐
        console.log(`🔍 [CONSULTA] Query: ${query} | Órdenes: ${ordenesRes.rows.length} | Tickets: ${ticketsRes.rows.length}`);
        if (ticketsRes.rows.length > 0) {
            console.log(`📊 Estados:`, ticketsRes.rows.map(t => t.estado_pago));
        }

        res.json({
            ordenes: [], // ⭐ FORZAMOS VACÍO PARA ENFOCARNOS SOLO EN TICKETS ⭐
            tickets: ticketsRes.rows
        });
    } catch (e) {
        console.error("❌ Error en /api/consultar:", e);
        res.status(500).json({ error: 'Error interno al consultar: ' + e.message });
    }
});

module.exports = router;
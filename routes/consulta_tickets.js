const express = require('express');
const { db } = require('../database');
const router = express.Router();

// ⭐ RUTA EXCLUSIVA PARA BUSCAR TICKETS (IGNORA ÓRDENES DE PRODUCTOS) ⭐
router.get('/consultar-tickets', async (req, res) => {
    const query = req.query.query;

    if (!query) {
        return res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        // ⭐ FORZAMOS LA LECTURA PARA EVITAR CACHÉ DE TURSO ⭐
        await db.execute({ sql: "SELECT 1", mode: "write" });

        const ticketsRes = await db.execute({
            sql: `SELECT t.*, s.nombre as sorteo_nombre 
                  FROM tickets t 
                  JOIN sorteos s ON s.id = t.sorteo_id 
                  WHERE (t.cliente_dni = ? OR t.cliente_telefono = ? OR t.cliente_nombre LIKE ?) 
                  ORDER BY t.id DESC`,
            args: [query, query, `%${query}%`],
            mode: "write"
        });

        // ⭐ ESTE LOG SALDRÁ EN LA CONSOLA DE RENDER ⭐
        console.log(`🔍 [CONSULTA TICKETS] Query: ${query} | Tickets encontrados: ${ticketsRes.rows.length}`);

        res.json({
            tickets: ticketsRes.rows
        });
    } catch (e) {
        console.error("❌ Error en /api/consultar-tickets:", e);
        res.status(500).json({ error: 'Error interno al consultar: ' + e.message });
    }
});

module.exports = router;
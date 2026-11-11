const express = require('express');
const { db } = require('../database');
const router = express.Router();

router.get('/consultar-tickets', async (req, res) => {
    const query = req.query.query;

    if (!query) {
        return res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        await db.execute({ sql: "SELECT 1", mode: "write" });

        let sqlQuery = "";
        let args = [];

        // ⭐ SI LA BÚSQUEDA ES 'ALL', TRAEMOS TODO ⭐
        if (query === 'all') {
            sqlQuery = `SELECT t.*, s.nombre as sorteo_nombre 
                        FROM tickets t 
                        JOIN sorteos s ON s.id = t.sorteo_id 
                        ORDER BY t.id DESC LIMIT 50`;
        } else {
            sqlQuery = `SELECT t.*, s.nombre as sorteo_nombre 
                        FROM tickets t 
                        JOIN sorteos s ON s.id = t.sorteo_id 
                        WHERE (t.cliente_dni = ? OR t.cliente_telefono = ? OR t.cliente_nombre LIKE ?) 
                        ORDER BY t.id DESC`;
            args = [query, query, `%${query}%`];
        }

        const ticketsRes = await db.execute({
            sql: sqlQuery,
            args: args,
            mode: "write"
        });

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
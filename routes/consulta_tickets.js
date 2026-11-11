const express = require('express');
const { db } = require('../database');
const router = express.Router();

router.get('/consultar-tickets', async (req, res) => {
    const query = req.query.query;

    if (!query) {
        return res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    try {
        // ⭐ PRUEBA DE CONEXIÓN REAL ⭐
        // Si esto falla, significa que Render no está conectado a Turso.
        const testConexion = await db.execute({
            sql: "SELECT count(*) as total FROM tickets",
            mode: "write"
        });
        
        const totalTickets = testConexion.rows[0].total;
        
        if (totalTickets === 0) {
            return res.status(500).json({ 
                error: `La base de datos a la que se conectó Render tiene 0 tickets. Esto significa que Render NO está usando Turso, sino una base de datos local vacía.` 
            });
        }

        let sqlQuery = "";
        let args = [];

        if (query === 'all') {
            sqlQuery = `SELECT t.*, s.nombre as sorteo_nombre FROM tickets t JOIN sorteos s ON s.id = t.sorteo_id ORDER BY t.id DESC LIMIT 50`;
        } else {
            sqlQuery = `SELECT t.*, s.nombre as sorteo_nombre FROM tickets t JOIN sorteos s ON s.id = t.sorteo_id WHERE (t.cliente_dni = ? OR t.cliente_telefono = ? OR t.cliente_nombre LIKE ?) ORDER BY t.id DESC`;
            args = [query, query, `%${query}%`];
        }

        const ticketsRes = await db.execute({ sql: sqlQuery, args: args, mode: "write" });

        res.json({ tickets: ticketsRes.rows });

    } catch (e) {
        // Si hay un error de conexión a Turso, lo devolvemos a la pantalla
        console.error("❌ Error de conexión:", e);
        res.status(500).json({ 
            error: `Error de conexión a la base de datos: ${e.message}. Revisa las variables de entorno en Render.` 
        });
    }
});

module.exports = router;
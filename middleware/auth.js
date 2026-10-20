function requireAdmin(req, res, next) {
    if (req.session && req.session.userId && req.session.rol === 'admin') {
        return next();
    }
    // Si es API, devolver JSON; si es HTML, redirigir
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    return res.redirect('/admin/login.html');
}

module.exports = { requireAdmin };
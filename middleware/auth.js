const jwt = require('jsonwebtoken');

function requireRol(...rolesPermitidos) {
    return (req, res, next) => {
        const token = req.cookies.token;
        
        if (!token) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
            }
            return res.redirect('/admin/login.html');
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
            req.user = decoded;

            if (req.user.rol === 'admin') return next();
            if (rolesPermitidos.includes(req.user.rol)) return next();

            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
            }
            return res.redirect('/admin/dashboard.html');

        } catch (err) {
            res.clearCookie('token');
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Sesión expirada.' });
            }
            return res.redirect('/admin/login.html');
        }
    };
}

const requireAdmin = requireRol('admin');
const requireVendedor = requireRol('vendedor');
const requireCliente = requireRol('cliente');

module.exports = { requireRol, requireAdmin, requireVendedor, requireCliente };
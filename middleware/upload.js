const multer = require('multer');
const path = require('path');

// ⭐ CAMBIO IMPORTANTE: Guardamos en memoria RAM para extraer Base64 ⭐
const storageMemory = multer.memoryStorage();

const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
};

// Lo usamos para productos, sorteos, carrusel y configuración
const uploadProducto = multer({
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('imagen');

const uploadComprobante = multer({
    storage: storageMemory,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('comprobante');

module.exports = { uploadComprobante, uploadProducto };
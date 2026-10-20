const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- 1. CONFIGURACIÓN PARA PRODUCTOS Y SORTEOS (Disco Duro) ---
const dirImagenes = path.join(__dirname, '..', 'uploads', 'imagenes');
if (!fs.existsSync(dirImagenes)) {
    fs.mkdirSync(dirImagenes, { recursive: true });
}

const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, dirImagenes);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + ext);
    }
});

const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
};

const uploadProducto = multer({
    storage: diskStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('imagen');

// --- 2. CONFIGURACIÓN PARA COMPROBANTES (Memoria RAM) ---
const memoryStorage = multer.memoryStorage();

const uploadComprobante = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('comprobante');

module.exports = { uploadComprobante, uploadProducto };
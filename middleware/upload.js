const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary'); // Importa la configuración
const streamifier = require('streamifier');

const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
};

// 1. Configuración en memoria para PRODUCTOS, SORTEOS y CARRUSEL
const memoryStorage = multer.memoryStorage();

const uploadProducto = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB
    fileFilter
}).single('imagen');

// 2. Configuración en memoria para COMPROBANTES
const uploadComprobante = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('comprobante');

// 3. Función para enviar el archivo a Cloudinary (CON OPTIMIZACIÓN)
const subirACloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { 
                folder: 'mariposita',
                // ⭐ OPTIMIZACIÓN AUTOMÁTICA DE IMAGEN
                // width: 1200 -> Reduce el tamaño físico (no guarda fotos de 4000px)
                // crop: "limit" -> No recorta, solo encoge si es más grande
                // fetch_format: "auto" -> Convierte a WebP (mucho más ligero)
                // quality: "auto" -> Ajusta la compresión para que no se vea borrosa
                transformation: [
                    { width: 1200, crop: "limit" },
                    { fetch_format: "auto", quality: "auto" }
                ]
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        streamifier.createReadStream(buffer).pipe(stream);
    });
};

module.exports = { uploadComprobante, uploadProducto, subirACloudinary };
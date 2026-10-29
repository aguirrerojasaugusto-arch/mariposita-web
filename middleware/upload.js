const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary'); // Asegúrate de tener este archivo creado
const streamifier = require('streamifier');

const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
};

// ⭐ 1. Configuración en memoria para PRODUCTOS, SORTEOS y CARRUSEL
const memoryStorage = multer.memoryStorage();

const uploadProducto = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('imagen');

// ⭐ 2. Configuración en memoria para COMPROBANTES (ya estaba así)
const uploadComprobante = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single('comprobante');

// ⭐ 3. Función para enviar el archivo a Cloudinary (CON OPTIMIZACIÓN AUTOMÁTICA)
const subirACloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { 
                folder: 'mariposita',
                // ⭐ OPTIMIZACIÓN AUTOMÁTICA
                // Redimensiona a un ancho máximo de 1200px (para no guardar fotos gigantes)
                // f_auto elige el mejor formato (WebP)
                // q_auto ajusta la calidad sin perder nitidez
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
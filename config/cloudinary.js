const cloudinary = require('cloudinary').v2;

// ⚠️ PRUEBA DE EMERGENCIA: Escribimos las credenciales directamente
cloudinary.config({
  cloud_name: 'bvwbvsqk',                  // Tu Cloud Name
  api_key: '177269444393927',              // Reemplaza con tu número (ej. 177269...)
  api_secret: 'GtmsC0xwr_FihqsOM6kfTI0f5fU',        // Reemplaza con tu secreto (ej. Gtms...)
  secure: true
});

module.exports = cloudinary;
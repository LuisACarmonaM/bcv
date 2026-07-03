require("dotenv").config(); // Para leer variables de entorno en local
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");
const NodeCache = require("node-cache");
const cron = require("node-cron");
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

// 2. Inicializar Firebase de forma segura usando Variables de Entorno
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
  }),
});

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new NodeCache({ stdTTL: 3600 });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// 3. Variable global para recordar el último precio que notificamos
let ultimoPrecioConocido = null;

const parseRate = ($, selector) => {
  try {
    const text = $(selector).text().trim();
    if (!text) return null;

    const cleanText = text.replace(",", ".");
    const numericValue = cleanText.replace(/[^0-9.]/g, "");

    return parseFloat(numericValue);
  } catch (error) {
    return null;
  }
};

/**
 * Función centralizada de Scraping
 */
async function obtenerTasasDelBCV() {
  console.log(
    `[${new Date().toISOString()}] Solicitando datos en vivo al BCV...`,
  );
  const response = await axios.get("https://www.bcv.org.ve/", {
    httpsAgent,
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
  });

  const $ = cheerio.load(response.data);

  return {
    EUR: parseRate($, "#euro strong"),
    CNY: parseRate($, "#yuan strong"),
    TRY: parseRate($, "#lira strong"),
    RUB: parseRate($, "#rublo strong"),
    USD: parseRate($, "#dolar strong"),
    fecha_valor: $(".date-display-single").first().text().trim() || null,
  };
}

cron.schedule(
  "*/15 16-19 * * *",
  async () => {
    console.log(
      "-> Tarea programada ejecutándose: Verificando actualización del BCV...",
    );
    try {
      const data = await obtenerTasasDelBCV();

      // Guardamos la data fresca en la caché
      cache.set("bcv_rates", data);
      console.log("-> Caché actualizada con éxito por la tarea programada.");

      // 4. LÓGICA DE NOTIFICACIONES PUSH
      const nuevoPrecio = data.USD;

      if (
        ultimoPrecioConocido !== null &&
        ultimoPrecioConocido !== nuevoPrecio &&
        nuevoPrecio > 0
      ) {
        console.log(
          `¡Cambio detectado! De ${ultimoPrecioConocido} a ${nuevoPrecio}. Enviando notificaciones Push...`,
        );

        const mensaje = {
          notification: {
            title: "🚨 ¡Tasa del BCV Actualizada!",
            body: `El dólar pasó de Bs. ${ultimoPrecioConocido.toFixed(2)} a Bs. ${nuevoPrecio.toFixed(2)}`,
          },
          topic: "actualizaciones_bcv",
        };

        await getMessaging().send(mensaje);
        console.log(
          "-> 🟢 Notificaciones enviadas exitosamente a los dispositivos.",
        );
      } else {
        console.log(
          "-> ⚪ Tasa sin cambios o primer inicio. No se envían notificaciones.",
        );
      }

      // Actualizar la memoria del servidor
      if (nuevoPrecio > 0) {
        ultimoPrecioConocido = nuevoPrecio;
      }
    } catch (error) {
      console.error("-> Error en la tarea programada del BCV:", error.message);
    }
  },
  {
    scheduled: true,
    timezone: "America/Caracas",
  },
);

// Endpoint de tu API
app.get("/api/tasas-bcv", async (req, res) => {
  try {
    const cachedData = cache.get("bcv_rates");
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        source: "cache",
      });
    }

    // Si no está en caché, busca en vivo
    const data = await obtenerTasasDelBCV();
    cache.set("bcv_rates", data);

    // Alimenta la variable global la primera vez que alguien consulte la API
    // para evitar notificaciones falsas al arrancar el servidor
    if (ultimoPrecioConocido === null && data.USD > 0) {
      ultimoPrecioConocido = data.USD;
    }

    return res.status(200).json({
      success: true,
      data: data,
      source: "bcv-live",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error conectando con la fuente del BCV",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Node.js corriendo en el puerto ${PORT}`);
});

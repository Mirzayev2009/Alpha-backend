// 


// index.js — improved, robust version for local or server deployment
import dotenv from "dotenv";
dotenv.config(); // load .env first

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

const app = express();

// ---------- Configuration ----------
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000"; // set this in production to your frontend
const ALLOWED_ORIGINS = [FRONTEND_ORIGIN, "http://localhost:3000"];

// ---------- Middleware ----------
app.use(express.json());
app.use(cors({
  origin: function (origin, callback) {
    // allow non-browser requests (e.g. Postman) when origin is undefined
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("CORS: Origin not allowed"));
  }
}));

// ---------- Helpers ----------
/**
 * Safely load JSON file from ./data/<filename>
 * @param {string} filename - e.g. 'tours.json'
 * @returns {object} parsed JSON
 * @throws Error when file missing or invalid
 */
function loadJSONFile(filename) {
  const fullPath = path.resolve(process.cwd(), "data", filename);
  try {
    if (!fs.existsSync(fullPath)) {
      const e = new Error(`File not found: ${fullPath}`);
      e.code = "ENOENT";
      throw e;
    }
    const raw = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    // rethrow to be handled by route
    throw err;
  }
}

// ---------- Nodemailer setup (create transporter lazily) ----------
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    // Do not throw here; routes will check and return a useful error
    return null;
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass
    }
  });

  return transporter;
}

// ---------- Routes ----------

// Health
app.get("/ping", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Generic generator for simple JSON GET endpoints
function createJsonGetRoute(routePath, filename) {
  app.get(routePath, (req, res) => {
    try {
      const data = loadJSONFile(filename);
      return res.status(200).json(data);
    } catch (err) {
      console.error(`${routePath} error:`, err && err.message);
      if (err.code === "ENOENT") {
        return res.status(404).json({ error: "Data file not found" });
      }
      return res.status(500).json({ error: "Failed to load data" });
    }
  });
}

// register GET endpoints
createJsonGetRoute("/api/tours", "tours.json");
createJsonGetRoute("/api/destinations", "destinations.json");
createJsonGetRoute("/api/gallery", "gallery.json");
createJsonGetRoute("/api/team", "team.json");
createJsonGetRoute("/api/hotel", "hotel.json");
createJsonGetRoute("/api/transport", "transport.json");
createJsonGetRoute("/api/visa", "visa.json");

// POST /api/register - sends email
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, country, phone, message } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "name and email are required" });
    }

    const transporterInstance = getTransporter();
    if (!transporterInstance) {
      console.error("EMAIL_USER / EMAIL_PASS not configured");
      return res.status(500).json({ success: false, message: "Email not configured on server" });
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.RECEIVER_EMAIL || process.env.EMAIL_USER,
      subject: "New Registration Form",
      text:
        `Name: ${name}\nEmail: ${email}\nCountry: ${country || ""}\nPhone: ${phone || ""}\nMessage: ${message || ""}`
    };

    // Note: transporter.sendMail can throw — we await inside try/catch
    await transporterInstance.sendMail(mailOptions);

    return res.status(200).json({ success: true, message: "Registration email sent successfully!" });
  } catch (error) {
    console.error("POST /api/register error:", error && error.message);
    return res.status(500).json({ success: false, message: "Error sending email" });
  }
});

// POST /api/visa-question - simple echo
app.post("/api/visa-question", (req, res) => {
  try {
    const { fromCountry, toCountry, nationality, purpose, duration } = req.body || {};
    console.log("Visa question received:", { fromCountry, toCountry, nationality, purpose, duration });
    return res.json({ success: true, message: "Visa question received. We'll process it soon." });
  } catch (err) {
    console.error("POST /api/visa-question error:", err && err.message);
    return res.status(500).json({ success: false });
  }
});

// 404 fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err && err.stack ? err.stack : err);
  // If headers already sent, delegate to default Express handler
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------- Start server ----------
if (process.env.VERCEL) {
  // When deployed as serverless on Vercel, do NOT call app.listen().
  // Vercel supplies its own handler for functions or the platform will fail.
  console.log("Running in Vercel serverless environment (no listen).");
} else {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || "development"})`);
  });
}

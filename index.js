// server-supabase-index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();

// Paths
const __dirname = path.resolve();
const REGISTRATION_FILE = path.join(__dirname, "data", "registrations.json");
const DATA_DIR = path.dirname(REGISTRATION_FILE);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("data"));

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Supabase client (server should use service_role key)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. Exiting.");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Ensure data dir + fallback json exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(REGISTRATION_FILE)) fs.writeFileSync(REGISTRATION_FILE, JSON.stringify([]), "utf8");

const loadJSON = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    if (!data.trim()) return [];
    return JSON.parse(data);
  } catch (err) {
    console.error(`[LoadJSON] Error reading/parsing ${path.basename(filePath)}:`, err.message);
    throw new Error(`Failed to process data file: ${path.basename(filePath)}`);
  }
};
const saveJSON = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
};

// Static images
app.use("/images", express.static(path.join(__dirname, "data", "images")));

// Helper endpoints unchanged
const createGetDataEndpoint = (route, relativePath) => {
  const filePath = path.join(__dirname, relativePath);
  app.get(route, (req, res) => {
    try {
      const data = loadJSON(filePath);
      res.json(data);
    } catch (error) {
      console.error(`Error loading data for ${route}:`, error);
      res.status(500).json({ success: false, message: `Error loading data from ${path.basename(filePath)}` });
    }
  });
};

createGetDataEndpoint("/api/destinations", "data/destination.json");
createGetDataEndpoint("/api/gallery", "data/gallery.json");
createGetDataEndpoint("/api/team", "data/team.json");
createGetDataEndpoint("/api/hotel", "data/hotel.json");
createGetDataEndpoint("/api/transport", "data/transport.json");
createGetDataEndpoint("/api/visa", "data/visa.json");

app.get("/api/tours", (req, res) => {
  try {
    const toursData = loadJSON(path.join(__dirname, "data", "tours.json"));
    if (toursData && toursData.tours) return res.status(200).json(toursData.tours);
    return res.status(404).json({ success: false, message: "Tours data not found." });
  } catch (error) {
    console.error("Error fetching all tours:", error);
    res.status(500).json({ success: false, message: "Error loading tour data" });
  }
});

app.get("/api/tours/languages", (req, res) => {
  try {
    const toursData = loadJSON(path.join(__dirname, "data", "tours.json"));
    const uzbekistanLangs = Object.keys(toursData.tours?.uzbekistan || {});
    const worldLangs = Object.keys(toursData.tours?.world || {});
    const allLangs = [...new Set([...uzbekistanLangs, ...worldLangs])];

    res.status(200).json({
      success: true,
      languages: allLangs,
      categories: { uzbekistan: uzbekistanLangs, world: worldLangs },
    });
  } catch (error) {
    console.error("Error fetching languages:", error);
    res.status(500).json({ success: false, message: "Error loading language data" });
  }
});

/* ---------------------------
   Admin registrations (Supabase-backed)
   --------------------------- */

// Helper to map DB row (snake_case) -> client-friendly (camelCase)
const mapDbToClient = (row) => {
  if (!row) return row;
  return {
    // id may be numeric in DB; keep as-is
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tourTitle: row.tourTitle ?? row.tour_title ?? null,
    people: row.people,
    unitPrice: row.unitPrice ?? row.unit_price ?? 0,
    totalPrice: row.totalPrice ?? row.total_price ?? 0,
    status: row.status,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    message: row.message,
  };
};

/**
 * GET /api/admin/registrations
 */
app.get("/api/admin/registrations", async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let q = supabase.from("Alpha_registration_data").select("*").order("created_at", { ascending: false });

    if (statusFilter === "done" || statusFilter === "undone") {
      q = supabase.from("Alpha_registration_data").select("*").eq("status", statusFilter).order("created_at", { ascending: false });
    }

    const { data, error } = await q;
    if (error) {
      console.error("Supabase fetch error (GET list):", error);
      return res.status(500).json({ success: false, message: "Error fetching registrations" });
    }

    // map to camelCase for client
    const mapped = (data || []).map(mapDbToClient);
    return res.status(200).json(mapped);
  } catch (error) {
    console.error("Error fetching registrations:", error);
    res.status(500).json({ success: false, message: "Error fetching registrations" });
  }
});

/**
 * POST /api/registrations
 * - insert into Supabase using snake_case column names
 * - log debug info and return DB row (mapped)
 */
app.post("/api/registrations", async (req, res) => {
  try {
    const { name, email, phone, people, tourTitle, unitPrice, totalPrice } = req.body;

    if (!name || !email || !phone || !tourTitle || !totalPrice) {
      return res.status(400).json({ success: false, message: "Name, Email, Phone, Tour Title, and Total Price are required." });
    }

    // Prepare DB object with snake_case column names (match your Supabase table)
    const dbRow = {
      name,
      email,
      phone,
      tour_title: tourTitle,
      people: people || 1,
      unit_price: unitPrice || 0,
      total_price: totalPrice,
      status: "undone",
      created_at: new Date().toISOString(),
      message: `Booking request for ${tourTitle} (${people || 1} person(s)). Total: $${totalPrice}.`,
    };

    // Insert into Supabase
    const { data: insertData, error: insertError } = await supabase
      .from("Alpha_registration_data")
      .insert([dbRow])
      .select() // request the inserted row back
      .single();

    // DEBUG - always log these so you can see what happened
    console.log("DEBUG SUPABASE INSERT result:", { insertData, insertError });

    if (insertError) {
      // If something went wrong with Supabase insert, log and fall back to local file
      console.error("Supabase insert error:", insertError);

      // Attempt to create a local fallback record (with a hex id) so frontend still gets success UX
      const fallback = {
        id: crypto.randomBytes(16).toString("hex"),
        name,
        email,
        phone,
        tourTitle,
        people: people || 1,
        unitPrice: unitPrice || 0,
        totalPrice,
        status: "undone",
        createdAt: dbRow.created_at,
        message: dbRow.message,
      };

      try {
        const registrations = loadJSON(REGISTRATION_FILE);
        registrations.push(fallback);
        saveJSON(REGISTRATION_FILE, registrations);
      } catch (fileErr) {
        console.warn("Warning: could not save fallback local registration:", fileErr.message);
      }

      // Return fallback with explicit error message in response so you see it client-side
      return res.status(201).json({
        success: true,
        message: "Tour booking saved locally (Supabase insert failed). Check server logs for Supabase error.",
        data: fallback,
        supabaseError: insertError,
      });
    }

    // If insert succeeded, map DB row to client fields and respond
    const mapped = mapDbToClient(insertData);
    // Also update local file copy (optional)
    try {
      const registrations = loadJSON(REGISTRATION_FILE);
      registrations.push({ ...mapped, createdAt: mapped.createdAt });
      saveJSON(REGISTRATION_FILE, registrations);
    } catch (fileErr) {
      console.warn("Warning: could not sync local JSON file:", fileErr.message);
    }

    return res.status(201).json({ success: true, message: "Tour booking saved successfully!", data: mapped });
  } catch (err) {
    console.error("Error saving registration:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, message: "Error saving registration" });
  }
});

/**
 * PATCH /api/admin/registrations/:id
 * - expects numeric id (cast to Number) if your DB id is int8
 */
app.patch("/api/admin/registrations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== "done" && status !== "undone") {
      return res.status(400).json({ success: false, message: "Invalid status value. Must be 'done' or 'undone'." });
    }

    const idNumber = Number(id);
    if (Number.isNaN(idNumber)) {
      return res.status(400).json({ success: false, message: "Invalid id; must be numeric" });
    }

    // Check existence
    const { data: existing, error: selectErr } = await supabase
      .from("Alpha_registration_data")
      .select("*")
      .eq("id", idNumber)
      .limit(1)
      .single();

    if (selectErr || !existing) {
      console.error("Supabase select for patch error or not found:", selectErr);
      return res.status(404).json({ success: false, message: "Registration not found." });
    }

    const { data: updated, error: updateErr } = await supabase
      .from("Alpha_registration_data")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", idNumber)
      .select()
      .single();

    if (updateErr) {
      console.error("Supabase update error:", updateErr);
      return res.status(500).json({ success: false, message: "Error updating registration" });
    }

    // sync local file (best-effort)
    try {
      const registrations = loadJSON(REGISTRATION_FILE);
      const idx = registrations.findIndex((r) => String(r.id) === String(id) || Number(r.id) === idNumber);
      if (idx !== -1) {
        registrations[idx].status = status;
        registrations[idx].updatedAt = new Date().toISOString();
        saveJSON(REGISTRATION_FILE, registrations);
      }
    } catch (fileErr) {
      console.warn("Warning: could not sync local JSON file after patch:", fileErr.message);
    }

    const mapped = mapDbToClient(updated);
    return res.status(200).json({
      success: true,
      message: `Registration ${id} updated to status: ${status}`,
      data: mapped,
    });
  } catch (error) {
    console.error("Error patching registration:", error);
    return res.status(500).json({ success: false, message: "Error updating registration" });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`🚨 Global Error Handler Caught: ${err && (err.stack || err.message || err)}`);
  res.status(500).json({
    success: false,
    message: "Something went wrong on the server.",
    error: NODE_ENV === "development" ? (err && (err.message || String(err))) : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT} in ${NODE_ENV} mode`);
});

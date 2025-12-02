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

// server-supabase-index.js - FIXED POST ENDPOINT
app.post("/api/registrations", async (req, res) => {
  try {
    const { name, email, phone, people, tourTitle, unitPrice, totalPrice } = req.body;

    if (!name || !email || !phone || !tourTitle || !totalPrice) {
      return res.status(400).json({ success: false, message: "Name, Email, Phone, Tour Title, and Total Price are required." });
    }

    // ✅ FIXED: Use camelCase to match your Supabase column names
    const dbRow = {
      name,
      email,
      phone,
      tourTitle,  // ✅ Changed from tour_title
      people: people || 1,
      unitPrice: unitPrice || 0,  // ✅ Changed from unit_price
      totalPrice,  // ✅ Changed from total_price
      status: "undone",
      createdAt: new Date().toISOString(),  // ✅ Changed from created_at
      message: `Booking request for ${tourTitle} (${people || 1} person(s)). Total: $${totalPrice}.`,
    };

    console.log("🔍 Attempting to insert:", dbRow);

    // Insert into Supabase
    const { data: insertData, error: insertError } = await supabase
      .from("Alpha_registration_data")
      .insert([dbRow])
      .select()
      .single();

    console.log("📊 Supabase response:", { insertData, insertError });

    if (insertError) {
      console.error("❌ Supabase insert error:", insertError);

      // Fallback to local file
      const fallback = {
        id: crypto.randomBytes(16).toString("hex"),
        ...dbRow
      };

      try {
        const registrations = loadJSON(REGISTRATION_FILE);
        registrations.push(fallback);
        saveJSON(REGISTRATION_FILE, registrations);
      } catch (fileErr) {
        console.warn("⚠️ Could not save fallback:", fileErr.message);
      }

      return res.status(201).json({
        success: true,
        message: "Tour booking saved locally (Supabase insert failed).",
        data: fallback,
        supabaseError: insertError,
      });
    }

    // ✅ Success - sync to local file
    try {
      const registrations = loadJSON(REGISTRATION_FILE);
      registrations.push(insertData);
      saveJSON(REGISTRATION_FILE, registrations);
    } catch (fileErr) {
      console.warn("⚠️ Could not sync local JSON:", fileErr.message);
    }

    return res.status(201).json({ 
      success: true, 
      message: "Tour booking saved successfully!", 
      data: insertData 
    });
  } catch (err) {
    console.error("💥 Error saving registration:", err);
    return res.status(500).json({ success: false, message: "Error saving registration" });
  }
});

// ✅ ALSO FIX THE PATCH ENDPOINT
app.patch("/api/admin/registrations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== "done" && status !== "undone") {
      return res.status(400).json({ success: false, message: "Invalid status value." });
    }

    const idNumber = Number(id);
    if (Number.isNaN(idNumber)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const { data: existing, error: selectErr } = await supabase
      .from("Alpha_registration_data")
      .select("*")
      .eq("id", idNumber)
      .limit(1)
      .single();

    if (selectErr || !existing) {
      console.error("❌ Registration not found:", selectErr);
      return res.status(404).json({ success: false, message: "Registration not found." });
    }

    // ✅ Use camelCase for updatedAt
    const { data: updated, error: updateErr } = await supabase
      .from("Alpha_registration_data")
      .update({ status, updatedAt: new Date().toISOString() })  // Changed from updated_at
      .eq("id", idNumber)
      .select()
      .single();

    if (updateErr) {
      console.error("❌ Supabase update error:", updateErr);
      return res.status(500).json({ success: false, message: "Error updating registration" });
    }

    // Sync local file
    try {
      const registrations = loadJSON(REGISTRATION_FILE);
      const idx = registrations.findIndex((r) => Number(r.id) === idNumber);
      if (idx !== -1) {
        registrations[idx].status = status;
        registrations[idx].updatedAt = new Date().toISOString();
        saveJSON(REGISTRATION_FILE, registrations);
      }
    } catch (fileErr) {
      console.warn("⚠️ Could not sync local file:", fileErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Registration ${id} updated to status: ${status}`,
      data: updated,
    });
  } catch (error) {
    console.error("💥 Error patching registration:", error);
    return res.status(500).json({ success: false, message: "Error updating registration" });
  }
});

// ✅ REMOVE the mapDbToClient function - it's no longer needed
// Since we're using camelCase everywhere, no mapping required!

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

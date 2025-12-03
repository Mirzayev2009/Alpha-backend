// server-supabase-index.js - FINAL UPDATED VERSION
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

// Supabase client
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. Exiting.");
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

// Helper endpoints

// 👇 *** UPDATED HELPER FUNCTION ***
const createGetDataEndpoint = (route, relativePath, dataKey = null) => {
  const filePath = path.join(__dirname, relativePath);
  app.get(route, (req, res) => {
    try {
      const fullData = loadJSON(filePath);
      
      // If a dataKey is provided, return only that key's value (e.g., fullData.destinations)
      // This supports the new nested structure where the data list is under a key.
      const dataToSend = dataKey && fullData && fullData[dataKey] ? fullData[dataKey] : fullData;
      
      // If the data is empty or missing the key, return 404
      if (!dataToSend || (Array.isArray(dataToSend) && dataToSend.length === 0)) {
        return res.status(404).json({ success: false, message: `${path.basename(filePath)} data not found or is empty.` });
      }

      res.status(200).json(dataToSend);

    } catch (error) {
      console.error(`Error loading data for ${route}:`, error);
      res.status(500).json({ success: false, message: `Error loading data from ${path.basename(filePath)}` });
    }
  });
};
// 👆 *** END OF UPDATED HELPER FUNCTION ***

// 👇 *** UPDATED STATIC ENDPOINT CALLS ***
// Assuming the new data structure is { "destinations": { "en": [...], "ru": [...] } }
// If the key in destination.json is 'destinations', we pass 'destinations' as dataKey.
createGetDataEndpoint("/api/destinations", "data/destination.json", "destinations");
createGetDataEndpoint("/api/gallery", "data/gallery.json", "gallery");
createGetDataEndpoint("/api/team", "data/team.json", "team");
createGetDataEndpoint("/api/hotel", "data/hotel.json", "hotels");
createGetDataEndpoint("/api/transport", "data/transport.json", "transportOptions");
createGetDataEndpoint("/api/visa", "data/visa.json", "visaInfo"); 
// 👆 *** END OF UPDATED STATIC ENDPOINT CALLS ***

// 👇 *** UPDATED /api/tours ENDPOINT ***
app.get("/api/tours", (req, res) => {
  try {
    const toursData = loadJSON(path.join(__dirname, "data", "tours.json"));
    
    // Send the entire 'tours' object which contains all categories and languages
    if (toursData && toursData.tours) { 
      return res.status(200).json(toursData.tours); 
    }
    
    return res.status(404).json({ success: false, message: "Tours data not found or is empty." });
  } catch (error) {
    console.error("Error fetching all tours:", error);
    res.status(500).json({ success: false, message: "Error loading tour data" });
  }
});
// 👆 *** END OF UPDATED /api/tours ENDPOINT ***

app.get("/api/tours/languages", (req, res) => {
  // ... (this endpoint remains the same as it was already robust)
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
/* ============================================
   REGISTRATION ENDPOINTS (Supabase-backed)
   ============================================ */

/**
 * GET /api/admin/registrations
 * Fetches all registrations from Supabase
 */
app.get("/api/admin/registrations", async (req, res) => {
  try {
    const statusFilter = req.query.status;
    
    let query = supabase
      .from("Alpha_registration_data")
      .select("*")
      .order("created_at", { ascending: false });

    if (statusFilter === "done" || statusFilter === "undone") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    
    if (error) {
      console.error("❌ Supabase fetch error:", error);
      return res.status(500).json({ success: false, message: "Error fetching registrations" });
    }

    console.log(`✅ Fetched ${data?.length || 0} registrations from Supabase`);
    return res.status(200).json(data || []);
  } catch (error) {
    console.error("💥 Error fetching registrations:", error);
    res.status(500).json({ success: false, message: "Error fetching registrations" });
  }
});

/**
 * POST /api/registrations
 * Creates new tour booking in Supabase
 *
 * COLUMN MAPPING (from table schema):
 * - name, email, phone, tourTitle, people, unitPrice, totalPrice, status, message → as-is
 * - created_at, updated_at → Supabase auto-generates these (don't include in insert)
 */
app.post("/api/registrations", async (req, res) => {
  try {
    let { name, email, phone, people, tourTitle, unitPrice, totalPrice } = req.body;

    console.log("📥 Received registration request:", { name, email, tourTitle, people, totalPrice });

    // Validation
    if (!name || !email || !phone || !tourTitle || !totalPrice) {
      return res.status(400).json({ 
        success: false, 
        message: "Name, Email, Phone, Tour Title, and Total Price are required." 
      });
    }

    // Coerce numeric fields to numbers to match DB numeric columns
    people = Number(people) || 1;
    unitPrice = Number(unitPrice) || 0;
    totalPrice = Number(totalPrice);

    // If totalPrice is NaN or 0, require it (original validation required it)
    if (Number.isNaN(totalPrice) || totalPrice === 0) {
      return res.status(400).json({
        success: false,
        message: "Total price must be a valid number greater than 0."
      });
    }

    // Prepare insert object - EXACT match to Supabase columns
    // Using bracket notation for mixed-case columns
    const insertData = {
      name,
      email,
      phone,
      ['tourTitle']: tourTitle,
      people,
      ['unitPrice']: unitPrice,
      ['totalPrice']: totalPrice,
      status: "undone",
      message: `Booking request for ${tourTitle} (${people} person(s)). Total: $${totalPrice}.`,
    };

    console.log("🔍 Inserting into Supabase:", insertData);

    // Insert into Supabase
    const { data: result, error: insertError } = await supabase
      .from("Alpha_registration_data")
      .insert([insertData])
      .select('id, created_at, updated_at, name, email, phone, tourTitle, people, unitPrice, totalPrice, status, message')
      .single();

    console.log("📊 Supabase response:", { result, insertError });

    if (insertError) {
      console.error("❌ Supabase insert failed:", insertError);
      console.error("❌ Error code:", insertError.code);
      console.error("❌ Error message:", insertError.message);
      console.error("❌ Error details:", insertError.details);
      console.error("❌ Error hint:", insertError.hint);

      // Fallback to local file (keep this for safety)
      const fallback = {
        id: crypto.randomBytes(16).toString("hex"),
        ...insertData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      try {
        const registrations = loadJSON(REGISTRATION_FILE);
        registrations.push(fallback);
        saveJSON(REGISTRATION_FILE, registrations);
        console.log("💾 Saved to local file as fallback");
      } catch (fileErr) {
        console.warn("⚠️ Could not save fallback:", fileErr.message);
      }

      // Return 500 so client sees the DB failure (previously returned 201)
      return res.status(500).json({
        success: false,
        message: "Failed to save to database. Check server logs.",
        data: fallback,
        supabaseError: {
          code: insertError.code,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint
        }
      });
    }

    // ✅ SUCCESS!
    console.log("✅ Successfully saved to Supabase! ID:", result.id);
    
    // Backup to local file
    try {
      const registrations = loadJSON(REGISTRATION_FILE);
      registrations.push(result);
      saveJSON(REGISTRATION_FILE, registrations);
      console.log("💾 Also backed up to local file");
    } catch (fileErr) {
      console.warn("⚠️ Could not sync local JSON:", fileErr.message);
    }

    return res.status(201).json({ 
      success: true, 
      message: "Tour booking saved successfully to database!", 
      data: result 
    });

  } catch (err) {
    console.error("💥 Unexpected error:", err);
    console.error("💥 Stack trace:", err.stack);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error",
      error: NODE_ENV === "development" ? err.message : undefined
    });
  }
});

/**
 * PATCH /api/admin/registrations/:id
 * Updates registration status
 */
app.patch("/api/admin/registrations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log("📝 Update request:", { id, status });

    // Validation
    if (status !== "done" && status !== "undone") {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid status. Must be 'done' or 'undone'." 
      });
    }

    const idNumber = Number(id);
    if (Number.isNaN(idNumber)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid ID format" 
      });
    }

    // Check if exists
    const { data: existing, error: selectErr } = await supabase
      .from("Alpha_registration_data")
      .select("*")
      .eq("id", idNumber)
      .single();

    if (selectErr || !existing) {
      console.error("❌ Registration not found:", selectErr);
      return res.status(404).json({ 
        success: false, 
        message: "Registration not found" 
      });
    }

    // Update status (updated_at will auto-update if you have a trigger, or we set it manually)
    const { data: updated, error: updateErr } = await supabase
      .from("Alpha_registration_data")
      .update({ 
        status,
        updated_at: new Date().toISOString() // Manually set timestamp
      })
      .eq("id", idNumber)
      .select()
      .single();

    if (updateErr) {
      console.error("❌ Update failed:", updateErr);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to update status" 
      });
    }

    console.log("✅ Successfully updated registration:", updated.id);

    // Sync local file
    try {
      const registrations = loadJSON(REGISTRATION_FILE);
      const idx = registrations.findIndex(r => Number(r.id) === idNumber);
      if (idx !== -1) {
        registrations[idx] = updated;
        saveJSON(REGISTRATION_FILE, registrations);
      }
    } catch (fileErr) {
      console.warn("⚠️ Could not sync local file:", fileErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Status updated to ${status}`,
      data: updated
    });

  } catch (error) {
    console.error("💥 Error updating registration:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Error updating registration" 
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("🚨 Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: "Something went wrong",
    error: NODE_ENV === "development" ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Environment: ${NODE_ENV}`);
  console.log(`🔗 Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`🔑 Service role key configured: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Yes' : 'No'}`);
});

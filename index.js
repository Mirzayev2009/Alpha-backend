import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import crypto from "crypto";
import path from "path";

const app = express();

// --- Configuration Updates for Robust Path Resolution ---
// Use path.resolve() for reliable path resolution in deployment environments
const __dirname = path.resolve(); 
const REGISTRATION_FILE = path.join(__dirname, "data", "registrations.json");
const DATA_DIR = path.dirname(REGISTRATION_FILE);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('data'));

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Registration file setup (unchanged but robust)
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(REGISTRATION_FILE)) {
    // Initialize with an empty array if file doesn't exist
    fs.writeFileSync(REGISTRATION_FILE, JSON.stringify([]), 'utf8');
}

// Helper functions (Robust JSON loading for error prevention)
const loadJSON = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        if (!data.trim()) {
            // Treat empty file as an empty array
            return [];
        }
        return JSON.parse(data);
    } catch (error) {
        console.error(`[LoadJSON] Error reading/parsing ${path.basename(filePath)}:`, error.message);
        // Throw an error to be caught by the route handler
        throw new Error(`Failed to process data file: ${path.basename(filePath)}`);
    }
};

const saveJSON = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// Static images
app.use("/images", express.static(path.join(__dirname, "data", "images")));

// Helper for other endpoints (Path updated for consistency)
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

// Tours endpoints (Paths updated for consistency)
app.get("/api/tours", (req, res) => {
    try {
        const toursData = loadJSON(path.join(__dirname, "data", "tours.json"));
        if (toursData && toursData.tours) {
            res.status(200).json(toursData.tours);
        } else {
            res.status(404).json({ success: false, message: "Tours data not found." });
        }
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
            categories: { uzbekistan: uzbekistanLangs, world: worldLangs }
        });
    } catch (error) {
        console.error("Error fetching languages:", error);
        res.status(500).json({ success: false, message: "Error loading language data" });
    }
});


// Registration endpoints
app.get("/api/admin/registrations", (req, res) => {
    try {
        const registrations = loadJSON(REGISTRATION_FILE);
        const statusFilter = req.query.status;
        let filteredRegistrations = registrations;

        if (statusFilter === 'done' || statusFilter === 'undone') {
            filteredRegistrations = registrations.filter(r => r.status === statusFilter);
        }
        
        filteredRegistrations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.status(200).json(filteredRegistrations);
    } catch (error) {
        console.error("Error fetching registrations:", error);
        res.status(500).json({ success: false, message: "Error fetching registrations" });
    }
});

/**
 * 🚀 UPDATED: POST /api/registrations to correctly handle data sent from ToursDetail form.
 * It now expects name, email, phone, people, tourTitle, and totalPrice.
 */
app.post("/api/registrations", async (req, res) => {
    try {
        // Extract fields from the form submission data
        const { name, email, phone, people, tourTitle, unitPrice, totalPrice } = req.body;

        if (!name || !email || !phone || !tourTitle || !totalPrice) {
            return res.status(400).json({ success: false, message: "Name, Email, Phone, Tour Title, and Total Price are required." });
        }

        const registrations = loadJSON(REGISTRATION_FILE);

        const newRegistration = {
            id: crypto.randomBytes(16).toString("hex"),
            name,
            email,
            phone,
            tourTitle,
            people: people || 1, // Default to 1
            unitPrice: unitPrice || 0,
            totalPrice,
            status: "undone",
            createdAt: new Date().toISOString(),
            // Adding a dynamic message for clarity in the admin panel
            message: `Booking request for ${tourTitle} (${people} person(s)). Total: $${totalPrice}.`,
        };

        registrations.push(newRegistration);
        saveJSON(REGISTRATION_FILE, registrations);

        res.status(201).json({ success: true, message: "Tour booking saved successfully!", data: newRegistration });
    } catch (error) {
        console.error("Error saving registration:", error);
        res.status(500).json({ success: false, message: "Error saving registration" });
    }
});

app.patch("/api/admin/registrations/:id", (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (status !== 'done' && status !== 'undone') {
            return res.status(400).json({ success: false, message: "Invalid status value. Must be 'done' or 'undone'." });
        }

        const registrations = loadJSON(REGISTRATION_FILE);
        const registrationIndex = registrations.findIndex(r => r.id === id);

        if (registrationIndex === -1) {
            return res.status(404).json({ success: false, message: "Registration not found." });
        }

        registrations[registrationIndex].status = status;
        registrations[registrationIndex].updatedAt = new Date().toISOString();

        saveJSON(REGISTRATION_FILE, registrations);

        res.status(200).json({ 
            success: true, 
            message: `Registration ${id} updated to status: ${status}`,
            data: registrations[registrationIndex]
        });
    } catch (error) {
        console.error("Error patching registration:", error);
        res.status(500).json({ success: false, message: "Error updating registration" });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(`🚨 Global Error Handler Caught: ${err.stack}`);
    res.status(500).json({ 
        success: false, 
        message: 'Something went wrong on the server.',
        error: NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT} in ${NODE_ENV} mode`);
});
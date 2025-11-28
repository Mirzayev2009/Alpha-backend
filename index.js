import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import crypto from "crypto";
import path from "path";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('data'));

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Registration file setup
const REGISTRATION_FILE = path.join(process.cwd(), "data", "registrations.json"); 
const DATA_DIR = path.dirname(REGISTRATION_FILE);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(REGISTRATION_FILE)) {
    fs.writeFileSync(REGISTRATION_FILE, JSON.stringify([]), 'utf8');
}

// Helper functions
const loadJSON = (filePath) => {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
};

const saveJSON = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// Static images
app.use("/images", express.static(path.join(process.cwd(), "data", "images")));

// Helper for other endpoints
const createGetDataEndpoint = (route, filePath) => {
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

createGetDataEndpoint("/api/destinations", "./data/destination.json");
createGetDataEndpoint("/api/gallery", "./data/gallery.json");
createGetDataEndpoint("/api/team", "./data/team.json");
createGetDataEndpoint("/api/hotel", "./data/hotel.json");
createGetDataEndpoint("/api/transport", "./data/transport.json");
createGetDataEndpoint("/api/visa", "./data/visa.json");


// ✅ UPDATED: Get ALL tours data in all languages and categories
app.get("/api/tours", (req, res) => {
    try {
        const toursData = loadJSON("./data/tours.json");
        
        // Return the entire tours object which contains both 'uzbekistan' and 'world' categories
        if (toursData && toursData.tours) {
            res.status(200).json(toursData.tours);
        } else {
            // If the file exists but 'tours' key is missing or data is malformed
            res.status(404).json({ 
                success: false, 
                message: "Tours data not found or 'tours' key is missing in the data file." 
            });
        }
    } catch (error) {
        console.error("Error fetching all tours:", error);
        res.status(500).json({ 
            success: false, 
            message: "Error loading tour data" 
        });
    }
});

// ✅ REMOVED: The old multi-parameter route is removed since the frontend will handle filtering.
// app.get("/api/tours/:lang/:category", ... );


// ✅ NEW: Get all available languages (This endpoint remains useful)
app.get("/api/tours/languages", (req, res) => {
    try {
        const toursData = loadJSON("./data/tours.json");
        const uzbekistanLangs = Object.keys(toursData.tours?.uzbekistan || {});
        const worldLangs = Object.keys(toursData.tours?.world || {});
        
        // Get unique languages across both categories
        const allLangs = [...new Set([...uzbekistanLangs, ...worldLangs])];
        
        res.status(200).json({
            success: true,
            languages: allLangs,
            categories: {
                uzbekistan: uzbekistanLangs,
                world: worldLangs
            }
        });
    } catch (error) {
        console.error("Error fetching languages:", error);
        res.status(500).json({ 
            success: false, 
            message: "Error loading language data" 
        });
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

app.post("/api/registrations", async (req, res) => {
    try {
        const { name, email, country, phone, message } = req.body;

        if (!name || !email) {
            return res.status(400).json({ success: false, message: "Name and Email are required." });
        }

        const registrations = loadJSON(REGISTRATION_FILE);

        const newRegistration = {
            id: crypto.randomBytes(16).toString("hex"),
            name,
            email,
            country: country || 'Not Specified',
            phone: phone || 'Not Specified',
            message: message || '',
            status: "undone",
            createdAt: new Date().toISOString(),
        };

        registrations.push(newRegistration);
        saveJSON(REGISTRATION_FILE, registrations);

        res.status(201).json({ success: true, message: "Registration saved successfully!", data: newRegistration });
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
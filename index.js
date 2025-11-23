// index.js — your main backend entry file
import "dotenv/config";


// 1️⃣ Import required modules
import express from "express"; // The Express framework
import cors from "cors";       // To allow frontend requests (cross-origin)
import dotenv from "dotenv";   // For environment variables
import fs from "fs";           // To read JSON data files
import nodemailer from "nodemailer"; // For sending emails

// 2️⃣ Initialize dotenv to read .env
dotenv.config();

// 3️⃣ Create the Express app
const app = express();

// 4️⃣ Middleware setup
app.use(cors());               // Allow requests from any origin (frontend)
app.use(express.json());       // Parse JSON request bodies

// 5️⃣ Define the port
const PORT = process.env.PORT || 5000;

// 6️⃣ Create helper function to load JSON safely
// const loadJSON = (path) => {
//   const data = fs.readFileSync(path);
//   return JSON.parse(data);
// };
const loadJSON = (path) => {
  const data = fs.readFileSync(path);
  return JSON.parse(data)
}

// 7️⃣ Create GET endpoints for your data files
// app.get("/api/tours", (req, res) => {
//   const tours = loadJSON("./data/tours.json");
//   res.json(tours);
// });

app.use("/images", express.static("data/images"));


app.get("/api/tours", (req, res)=> {
  const tours = loadJSON("./data/tours.json");
  res.json(tours)
})

app.get("/api/destinations", (req, res) => {
  const destinations = loadJSON("./data/destination.json");
  res.json(destinations);
});

app.get("/api/gallery", (req, res) => {
  const gallery = loadJSON("./data/gallery.json");
  res.json(gallery);
});

app.get("/api/team", (req, res) => {
  const team = loadJSON("./data/team.json");
  res.json(team);
});

app.get("/api/hotel", (req, res) => {
  const services = loadJSON("./data/hotel.json");
  res.json(services);
});
app.get("/api/transport", (req, res) => {
  const services = loadJSON("./data/transport.json");
  res.json(services);
});

// The visa data (we’ll later add filtering logic)
app.get("/api/visa", (req, res) => {
  const visa = loadJSON("./data/visa.json");
  res.json(visa);
});

// add near other routes (after static middleware)


app.get("/api/transport/:id/image", (req, res) => {
  try {
    const id = req.params.id;
    const data = loadJSON("./data/transport.json"); // your loader
    const item = data.transport.find(t => t.id === id);
    if (!item) return res.status(404).json({ error: "Transport not found" });

    // normalize image field: allow "data/images/..." or "/data/images/..." or "/images/..."
    let img = item.image || "";
    // make it point to your public static route:
    img = img.replace(/^\/?data\/images\//, "/images/"); // convert "data/images/..." to "/images/..."
    img = img.replace(/^\/data\/public\//, "/images/"); // extra safety, if needed

    // if img doesn't start with /images, try to construct it
    if (!img.startsWith("/images")) {
      const baseName = path.basename(item.image || "");
      img = `/images/${baseName}`;
    }

    // redirect browser to the static file URL
    return res.redirect(302, img);
  } catch (err) {
    console.error("/api/transport/:id/image error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


// 8️⃣ POST endpoint: Registration form (send email)
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, country, phone, message } = req.body;

    // Set up transporter (SMTP)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Prepare email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.RECEIVER_EMAIL,
      subject: "New Registration Form",
      text: `
        Name: ${name}
        Email: ${email}
        Country: ${country}
        Phone: ${phone}
        Message: ${message}
      `,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true, message: "Registration email sent successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error sending email" });
  }
});



// 🔟 Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

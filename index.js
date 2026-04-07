const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. CONNECT TO YOUR MONGODB VAULT ---
const MONGO_URI = "mongodb+srv://prathambhagat892_db_user:a1B7EYb1grFffK6F@cluster0.dtzwdst.mongodb.net/surgicalRoute?appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Vault Connected! ✅"))
    .catch(err => console.log("Database Error: ❌", err));

// --- 2. DEFINE PATIENT DATA (THE TEMPLATE) ---
const leadSchema = new mongoose.Schema({
    name: String, email: String, phone: String, country: String,
    department: String, date: String, time: String, message: String,
    createdAt: { type: Date, default: Date.now }
});
const Lead = mongoose.model("Lead", leadSchema);

// --- 3. MIDDLEWARE (SECURITY GUARDS) ---
app.use(cors({ origin: "*" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- 4. ROUTE: SAVE DATA FROM WEBSITE ---
app.post("/contact", async (req, res) => {
    try {
        const newLead = new Lead(req.body);
        await newLead.save(); // Saves forever in MongoDB!
        console.log("New lead saved to MongoDB! 📁 :", req.body.name);
        res.status(200).json({ message: "Form submitted successfully!" });
    } catch (err) {
        console.error("Save Error:", err);
        res.status(500).json({ message: "Error saving lead" });
    }
});

// --- 5. ROUTE: GET DATA FOR ADMIN PANEL ---
app.get("/get-leads", async (req, res) => {
    try {
        const leads = await Lead.find().sort({ createdAt: -1 }); // Newest first
        res.status(200).json(leads); // Sends data to your Admin Panel
    } catch (err) {
        console.error("Fetch Error:", err);
        res.status(500).json({ message: "Error fetching leads" });
    }
});

// --- START ENGINE ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

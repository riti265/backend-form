const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors"); // Added CORS for security

const app = express();

// IMPORTANT: Render PORT
const PORT = process.env.PORT || 3000;

// middleware
app.use(cors({ origin: "*" })); // This allows your cPanel site to connect
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// handle form submit from your website
app.post("/contact", (req, res) => {
    // These names match the "name" attributes in your contact.html form
    const { name, email, phone, country, department, date, time, message } = req.body;

    // Create a row for your CSV file
    const row = `${name},${email},${phone},${country},${department},${date},${time},"${message}"\n`;
    const filePath = path.join(__dirname, "data.csv");

    // create file with header if not exists
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "Name,Email,Phone,Country,Department,Date,Time,Message\n");
    }

    fs.appendFileSync(filePath, row);

    // Send a success response back to your website
    res.status(200).json({ message: "Form submitted successfully!" });
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// open form
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "form.html"));
});

// submit form
app.post("/submit", (req, res) => {
  const { name, email, phone } = req.body;

  const filePath = path.join(__dirname, "data.csv");

  // create header if file not exists
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "Name,Email,Phone\n");
  }

  // add row
  fs.appendFileSync(filePath, `${name},${email},${phone}\n`);

  res.send("✅ Form submitted successfully!");
});

// start server
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

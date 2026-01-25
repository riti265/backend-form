const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

// IMPORTANT: Render PORT
const PORT = process.env.PORT || 3000;

// middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// open form page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "form.html"));
});

// handle form submit
app.post("/submit", (req, res) => {
  const { name, email, phone } = req.body;

  const row = `${name},${email},${phone}\n`;
  const filePath = path.join(__dirname, "data.csv");

  // create file with header if not exists
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "Name,Email,Phone\n");
  }

  fs.appendFileSync(filePath, row);

  res.send("Form submitted successfully!");
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

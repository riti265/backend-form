const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

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

  // create csv with header if not exists
  if (!fs.existsSync("form-data.csv")) {
    fs.writeFileSync("form-data.csv", "Name,Email,Phone\n");
  }

  fs.appendFileSync("form-data.csv", row);

  res.send("<h2>Form submitted successfully ✅</h2>");
});

// start server
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
const express = require("express");
const nodemailer = require("nodemailer");
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

// handle submit
app.post("/submit", async (req, res) => {
  const { name, email, phone } = req.body;

  // EMAIL SETUP
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: "New Form Submission",
    text: `
Name: ${name}
Email: ${email}
Phone: ${phone}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.send("Form submitted successfully & email sent!");
  } catch (error) {
    console.error(error);
    res.send("Form submitted but email failed.");
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

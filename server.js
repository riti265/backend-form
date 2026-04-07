const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;

////////////////////////////////////////////////////
// MIDDLEWARE
////////////////////////////////////////////////////
const helmet = require('helmet');
app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));
app.get('/', (req, res) => {
   res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // true when using HTTPS
        maxAge: 1000 * 60 * 30 // 30 minutes
    }
}));


const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many login attempts. Try again later."
});

////////////////////////////////////////////////////
// MONGODB CONNECTION
////////////////////////////////////////////////////
mongoose.connect('mongodb://127.0.0.1:27017/surgicalRouteDB')
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log(err));
  
////////////////////////////////////////////////////
// FILE UPLOAD (MULTER)
////////////////////////////////////////////////////

const storage = multer.diskStorage({
 destination: function (req, file, cb) {
   cb(null, 'uploads/')
 },
 filename: function (req, file, cb) {
   cb(null, Date.now() + "-" + file.originalname)
 }
})

const upload = multer({ storage: storage })

////////////////////////////////////////////////////
// EMAIL TRANSPORTER
////////////////////////////////////////////////////
////////////////////////////////////////////////////
// EMAIL TRANSPORTER
////////////////////////////////////////////////////
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

////////////////////////////////////////////////////
// SCHEMA
////////////////////////////////////////////////////
const contactSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    country: String,
    department: String,
    message: String,
    report: String,
    source: String,   // 👈 ADD THIS LINE
    date: String,
    time: String,
    status: { type: String, default: "Pending" },
    createdAt: { type: Date, default: Date.now }
});

const Contact = mongoose.model('Contact', contactSchema);

////////////////////////////////////////////////////
// USER FORM
////////////////////////////////////////////////////
app.post('/contact', upload.single('report'), async (req, res) => {
    try {

        const now = new Date();

       const newContact = new Contact({
       ...req.body,
          report: req.file ? req.file.filename : null,
            source: req.body.source || "Home Page",
            date: now.toISOString().split("T")[0],
            time: now.toTimeString().split(" ")[0]
        });

        await newContact.save();

        res.redirect('/?success=true');

    } catch (err) {
        console.log(err);
        res.send("Error saving data");
    }
});
////////////////////////////////////////////////////
// LOGIN PAGE
////////////////////////////////////////////////////
app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});
////////////////////////////////////////////////////
// LOGIN LOGIC
////////////////////////////////////////////////////
app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME) {
        const match = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

        if (match) {
            req.session.admin = true;
            return res.redirect('/admin');
        }
    }

    res.send("Invalid Credentials");
});

////////////////////////////////////////////////////
// AUTH
////////////////////////////////////////////////////
function isAdmin(req, res, next) {
    if (!req.session.admin) {
        return res.redirect('/login');
    }
    next();
}
////////////////////////////////////////////////////
// ADMIN PANEL
////////////////////////////////////////////////////
app.get('/admin', isAdmin, async (req, res) => {

    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

   const contacts = await Contact.find({
    name: { $regex: search, $options: 'i' }
     })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = contacts.length;
    const approved = contacts.filter(c => c.status === "Approved").length;
    const rejected = contacts.filter(c => c.status === "Rejected").length;
    const pending = contacts.filter(c => c.status === "Pending").length;

    let rows = "";

    contacts.forEach(c => {
        rows += `
        <tr>

            <td>
                <strong>${c.name}</strong><br>
                <small class="text-muted">${c.email || '-'}</small>
            </td>

            <td>${c.phone}</td>
            <td>${c.country}</td>
            <td>${c.department}</td>
            <td>${c.source || '-'}</td>

            <td>
                ${c.date}<br>
                <small>${c.time}</small>
            </td>

            <td>${new Date(c.createdAt).toLocaleString()}</td>

            <td>
                <span class="badge bg-${
                    c.status === "Approved" ? "success" :
                    c.status === "Rejected" ? "danger" :
                    "warning"
                }">
                    ${c.status}
                </span>
            </td>

            <td>
           ${c.report ? `
          <a target="_blank" href="/uploads/${c.report}" class="btn btn-sm btn-primary">View</a>
          <a href="/uploads/${c.report}" download class="btn btn-sm btn-success">Download</a>
           ` : '-'}
            </td>

            <td>
                <div class="d-flex flex-column gap-2">

                    <div class="d-flex gap-2">
                        <a href="/approve/${c._id}" 
                           class="btn btn-sm btn-success flex-fill">
                           <i class="bi bi-check-circle"></i>
                        </a>

                        <a href="/reject/${c._id}" 
                           class="btn btn-sm btn-warning flex-fill">
                           <i class="bi bi-x-circle"></i>
                        </a>
                    </div>

                    <div class="d-flex gap-2">
                        <a href="/delete/${c._id}" 
                           class="btn btn-sm btn-danger flex-fill">
                           <i class="bi bi-trash"></i>
                        </a>

                        <a target="_blank"
                           href="https://wa.me/91${c.phone}?text=Hello ${c.name}, regarding your appointment at Surgical Route"
                           class="btn btn-sm flex-fill"
                           style="background:#25D366;color:white;">
                           <i class="bi bi-whatsapp"></i>
                        </a>
                    </div>

                </div>
            </td>

        </tr>
        `;
    });

    res.send(`
    <html>
    <head>
        <title>Admin Dashboard</title>
        <meta http-equiv="refresh" content="20">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
    </head>
    <body class="bg-light">

    <div class="container mt-5">
    <div class="card shadow p-4">

        <!-- HEADER -->
        <div class="d-flex justify-content-between align-items-center mb-4">
            <div>
                <h3 class="fw-bold mb-1">Admin Dashboard</h3>
                <p class="text-muted mb-0">Manage patient appointments</p>
            </div>

            <a href="/logout" class="btn btn-outline-dark">
                <i class="bi bi-box-arrow-right"></i> Logout
            </a>
        </div>

        <!-- DASHBOARD CARDS -->
        <div class="row g-4 mb-4">

            <div class="col-md-3">
                <div class="card text-white shadow border-0" style="background:#4e73df;">
                    <div class="card-body text-center">
                        <h6>Total</h6>
                        <h3>${total}</h3>
                    </div>
                </div>
            </div>

            <div class="col-md-3">
                <div class="card text-white shadow border-0" style="background:#f6c23e;">
                    <div class="card-body text-center">
                        <h6>Pending</h6>
                        <h3>${pending}</h3>
                    </div>
                </div>
            </div>

            <div class="col-md-3">
                <div class="card text-white shadow border-0" style="background:#1cc88a;">
                    <div class="card-body text-center">
                        <h6>Approved</h6>
                        <h3>${approved}</h3>
                    </div>
                </div>
            </div>

            <div class="col-md-3">
                <div class="card text-white shadow border-0" style="background:#e74a3b;">
                    <div class="card-body text-center">
                        <h6>Rejected</h6>
                        <h3>${rejected}</h3>
                    </div>
                </div>
            </div>

        </div>

        <!-- SEARCH -->
       <!-- SEARCH + EXPORT -->
<form method="GET" action="/admin" class="mb-3">
    <div class="d-flex gap-2">
        <input name="search" value="${search}" class="form-control"
        placeholder="Search by patient name">

        <button class="btn btn-primary">
            Search
        </button>

        <a href="/export" class="btn btn-success">
            <i class="bi bi-file-earmark-excel"></i> Export
        </a>
    </div>
</form>

        <!-- TABLE -->
        <div class="table-responsive">
            <table class="table table-bordered table-striped align-middle">
                <thead class="table-dark">
                    <tr>
                        <th>Patient</th>
                        <th>Phone</th>
                        <th>Country</th>
                        <th>Department</th>
                        <th>Source</th>
                        <th>Appointment</th>
                        <th>Submitted</th>
                        <th>Status</th>
                        <th>Report</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            </div>
<div class="text-center mt-3">
    <a href="/admin?page=${page - 1}" class="btn btn-secondary">Previous</a>
    <a href="/admin?page=${page + 1}" class="btn btn-secondary">Next</a>
</div>
    </div>
    </div>

    </body>
    </html>
    `);

});

////////////////////////////////////////////////////
// APPROVE
////////////////////////////////////////////////////
app.get('/approve/:id', isAdmin, async (req, res) => {

    const contact = await Contact.findByIdAndUpdate(
        req.params.id,
        { status: "Approved" },
        { new: true }
    );

    if (contact.email) {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: contact.email,
            subject: "Appointment Approved - Surgical Route",
            html: `
                <h3>Appointment Confirmed ✅</h3>
                <p>Dear ${contact.name},</p>
                <p>Your appointment for <b>${contact.department}</b> on 
                <b>${contact.date}</b> at <b>${contact.time}</b> has been approved.</p>
                <p>Surgical Route Team</p>
            `
        });
    }

    res.redirect('/admin');
});

////////////////////////////////////////////////////
// REJECT
////////////////////////////////////////////////////
app.get('/reject/:id', isAdmin, async (req, res) => {

    const contact = await Contact.findByIdAndUpdate(
        req.params.id,
        { status: "Rejected" },
        { new: true }
    );

    if (contact.email) {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: contact.email,
            subject: "Appointment Update - Surgical Route",
            html: `
                <h3>Appointment Update ❌</h3>
                <p>Dear ${contact.name},</p>
                <p>Your appointment for <b>${contact.department}</b> on 
                <b>${contact.date}</b> at <b>${contact.time}</b> has been rejected.</p>
                <p>Please contact us.</p>
            `
        });
    }

    res.redirect('/admin');
});

////////////////////////////////////////////////////
app.get('/delete/:id', isAdmin, async (req, res) => {
    await Contact.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
});

////////////////////////////////////////////////////
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

////////////////////////////////////////////////////
// 👇 PASTE EXPORT CODE HERE
////////////////////////////////////////////////////

app.get('/export', isAdmin, async (req, res) => {

    const contacts = await Contact.find().sort({ createdAt: -1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Appointments');

    worksheet.columns = [
        { header: 'Name', key: 'name' },
        { header: 'Email', key: 'email' },
        { header: 'Phone', key: 'phone' },
        { header: 'Country', key: 'country' },
        { header: 'Department', key: 'department' },
        { header: 'Date', key: 'date' },
        { header: 'Time', key: 'time' },
        { header: 'Status', key: 'status' }
    ];

    contacts.forEach(contact => {
        worksheet.addRow(contact);
    });

    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
        'Content-Disposition',
        'attachment; filename=appointments.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();
});

////////////////////////////////////////////////////
app.listen(PORT, () => {
    console.log("Server running on http://localhost:3000");
});
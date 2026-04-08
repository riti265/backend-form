const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

////////////////////////////////////////////////////
// MIDDLEWARE
////////////////////////////////////////////////////
app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallbackSecret123',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, 
        maxAge: 1000 * 60 * 60 // 1 hour
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Try again later."
});

////////////////////////////////////////////////////
// MONGODB CONNECTION
////////////////////////////////////////////////////
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ MongoDB Error:", err));

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
    source: String,
    date: String,
    time: String,
    status: { type: String, default: "Pending" },
    createdAt: { type: Date, default: Date.now }
});

const Contact = mongoose.model('Contact', contactSchema);

////////////////////////////////////////////////////
// FILE UPLOAD (MULTER)
////////////////////////////////////////////////////
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage: storage });

////////////////////////////////////////////////////
// ROUTES
////////////////////////////////////////////////////

app.get('/', (req, res) => {
   res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
        res.status(500).send("Error saving data");
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    res.send("Invalid Credentials");
});

function isAdmin(req, res, next) {
    if (req.session.admin) return next();
    res.redirect('/login');
}

////////////////////////////////////////////////////
// ADMIN PANEL
////////////////////////////////////////////////////
app.get('/admin', isAdmin, async (req, res) => {
    try {
        const search = req.query.search || "";
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const query = { name: { $regex: search, $options: 'i' } };
        const contacts = await Contact.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Fetch counts directly from DB
        const total = await Contact.countDocuments();
        const pending = await Contact.countDocuments({ status: "Pending" });
        const approved = await Contact.countDocuments({ status: "Approved" });
        const rejected = await Contact.countDocuments({ status: "Rejected" });

        let rows = "";
        contacts.forEach(c => {
            rows += `
            <tr>
                <td><strong>${c.name}</strong><br><small>${c.email || '-'}</small></td>
                <td>${c.phone}</td>
                <td>${c.country}</td>
                <td>${c.department}</td>
                <td>${c.source || '-'}</td>
                <td>${c.date}<br><small>${c.time}</small></td>
                <td>${new Date(c.createdAt).toLocaleDateString()}</td>
                <td><span class="badge bg-${c.status === "Approved" ? "success" : c.status === "Rejected" ? "danger" : "warning"}">${c.status}</span></td>
                <td>${c.report ? `<a target="_blank" href="/uploads/${c.report}" class="btn btn-sm btn-primary">View</a>` : '-'}</td>
                <td>
                    <div class="d-flex gap-1">
                        <a href="/approve/${c._id}" class="btn btn-sm btn-success">✓</a>
                        <a href="/reject/${c._id}" class="btn btn-sm btn-warning">✗</a>
                        <a href="/delete/${c._id}" class="btn btn-sm btn-danger">🗑</a>
                    </div>
                </td>
            </tr>`;
        });

        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin Dashboard</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
        </head>
        <body class="bg-light p-4">
            <div class="container card shadow p-4">
                <div class="d-flex justify-content-between mb-4">
                    <h3>Surgical Route Admin</h3>
                    <a href="/logout" class="btn btn-dark">Logout</a>
                </div>
                <div class="row g-3 mb-4 text-center">
                    <div class="col-md-3"><div class="p-3 bg-primary text-white rounded">Total: ${total}</div></div>
                    <div class="col-md-3"><div class="p-3 bg-warning text-dark rounded">Pending: ${pending}</div></div>
                    <div class="col-md-3"><div class="p-3 bg-success text-white rounded">Approved: ${approved}</div></div>
                    <div class="col-md-3"><div class="p-3 bg-danger text-white rounded">Rejected: ${rejected}</div></div>
                </div>
                <form method="GET" class="d-flex gap-2 mb-3">
                    <input name="search" value="${search}" class="form-control" placeholder="Search name...">
                    <button class="btn btn-primary">Search</button>
                    <a href="/export" class="btn btn-success">Export</a>
                </form>
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead class="table-dark"><tr><th>Patient</th><th>Phone</th><th>Country</th><th>Dept</th><th>Source</th><th>Appt</th><th>Created</th><th>Status</th><th>File</th><th>Actions</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="10" class="text-center">No records found</td></tr>'}</tbody>
                    </table>
                </div>
                <div class="mt-3">
                    <a href="/admin?page=${page - 1}" class="btn btn-sm btn-secondary ${page <= 1 ? 'disabled' : ''}">Prev</a>
                    <span>Page ${page}</span>
                    <a href="/admin?page=${page + 1}" class="btn btn-sm btn-secondary">Next</a>
                </div>
            </div>
        </body>
        </html>`);
    } catch (err) {
        res.status(500).send("Dashboard Error: " + err.message);
    }
});

////////////////////////////////////////////////////
// STATUS UPDATES (NOW USING GOOGLE WEBHOOK)
////////////////////////////////////////////////////
app.get('/approve/:id', isAdmin, async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(req.params.id, { status: "Approved" }, { new: true });
        if (contact.email) {
            console.log("⏳ Sending approval email via Webhook to:", contact.email);
            await fetch('https://script.google.com/macros/s/AKfycbyUKtz07adWPHqfK8ldoOtOklyi4Y_j_zv8ZQhLvJjAw-pWJXP36UIVgV_CmnIIUruq/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: contact.email,
                    subject: "Appointment Approved - Surgical Route",
                    html: `<p>Dear ${contact.name}, your appointment for ${contact.department} on ${contact.date} has been officially approved. We will contact you shortly with further details.</p>`
                })
            });
            console.log("✅ Approval email successfully sent!");
        }
        res.redirect('/admin');
    } catch (e) { 
        console.error("❌ Email Error:", e);
        res.redirect('/admin'); 
    }
});

app.get('/reject/:id', isAdmin, async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(req.params.id, { status: "Rejected" }, { new: true });
        if (contact.email) {
            console.log("⏳ Sending rejection email via Webhook to:", contact.email);
            await fetch('https://script.google.com/macros/s/AKfycbyUKtz07adWPHqfK8ldoOtOklyi4Y_j_zv8ZQhLvJjAw-pWJXP36UIVgV_CmnIIUruq/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: contact.email,
                    subject: "Appointment Update - Surgical Route",
                    html: `<p>Dear ${contact.name}, we regret to inform you that we cannot proceed with your appointment at this time. Please contact us for further assistance.</p>`
                })
            });
            console.log("✅ Rejection email successfully sent!");
        }
        res.redirect('/admin');
    } catch (e) { 
        console.error("❌ Email Error:", e);
        res.redirect('/admin'); 
    }
});

app.get('/delete/:id', isAdmin, async (req, res) => {
    await Contact.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/export', isAdmin, async (req, res) => {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Appointments');
    worksheet.columns = [
        { header: 'Name', key: 'name' }, { header: 'Email', key: 'email' },
        { header: 'Phone', key: 'phone' }, { header: 'Country', key: 'country' },
        { header: 'Dept', key: 'department' }, { header: 'Date', key: 'date' },
        { header: 'Time', key: 'time' }, { header: 'Status', key: 'status' }
    ];
    contacts.forEach(c => worksheet.addRow(c));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=appointments.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
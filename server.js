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
app.set('trust proxy', 1); 

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallbackSecret123',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 1000 * 60 * 60 }
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
// UPGRADED SCHEMA (ADDED CRM FIELDS)
////////////////////////////////////////////////////
const contactSchema = new mongoose.Schema({
    name: String, email: String, phone: String, country: String,
    department: String, message: String, report: String, source: String,
    date: String, time: String, status: { type: String, default: "Pending" },
    
    // NEW CRM FIELDS
    leadStage: { type: String, default: "Follow-up Pending" },
    followUpDate: String,
    followUpTime: String,
    notes: [{ 
        text: String, 
        createdAt: { type: Date, default: Date.now } 
    }],
    
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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/contact', upload.single('report'), async (req, res) => {
    try {
        const newContact = new Contact({
            ...req.body,
            report: req.file ? req.file.filename : null,
            source: req.body.source || "Home Page"
        });
        await newContact.save();
        res.redirect('/?success=true');
    } catch (err) {
        res.status(500).send("Error saving data");
    }
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

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
// ADMIN PANEL & CRM
////////////////////////////////////////////////////
app.get('/admin', isAdmin, async (req, res) => {
    try {
        const search = req.query.search || "";
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const query = { name: { $regex: search, $options: 'i' } };
        const contacts = await Contact.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);

        const total = await Contact.countDocuments();
        const pending = await Contact.countDocuments({ status: "Pending" });
        const approved = await Contact.countDocuments({ status: "Approved" });
        const rejected = await Contact.countDocuments({ status: "Rejected" });

        let rows = "";
        contacts.forEach(c => {
            const submittedDate = new Date(c.createdAt).toLocaleDateString();
            const submittedTime = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const cleanPhone = c.phone.replace(/[^0-9]/g, ''); 
            const waMsg = encodeURIComponent(`Hello ${c.name}, this is Surgical Route reaching out regarding your recent medical inquiry.`);
            const waLink = `https://wa.me/${cleanPhone}?text=${waMsg}`;

            // Package data safely to send to the modal
            const safeNotes = encodeURIComponent(JSON.stringify(c.notes));
            const safeConcern = c.message ? c.message.replace(/'/g, "\\'") : 'NA';

            rows += `
            <tr>
                <td>
                    <a href="#" class="text-primary text-decoration-none" onclick="openCRMModal('${c._id}', '${c.name}', '${c.phone}', '${c.email}', '${c.status}', '${c.date}', '${c.time}', '${safeConcern}', '${c.leadStage}', '${c.followUpDate || ''}', '${c.followUpTime || ''}', '${safeNotes}', '${waLink}')">
                        <strong>${c.name}</strong>
                    </a>
                    <br><small>${c.email || '-'}</small>
                </td>
                <td>${c.phone}<br><small class="text-muted">${c.country}</small></td>
                <td><strong>${c.department}</strong><br><small class="text-muted">${c.source || '-'}</small></td>
                <td>📅 ${c.date || 'N/A'}<br>⏰ ${c.time || 'N/A'}</td>
                <td>${submittedDate}<br><small class="text-muted">${submittedTime}</small></td>
                <td><span class="badge bg-${c.status === "Approved" ? "success" : c.status === "Rejected" ? "danger" : "warning"}">${c.status}</span></td>
                <td>${c.report ? `<a target="_blank" href="/uploads/${c.report}" class="btn btn-sm btn-outline-primary">View</a>` : '-'}</td>
                <td>
                    <div class="d-flex gap-1">
                        <a href="/approve/${c._id}" class="btn btn-sm btn-success" title="Approve">✓</a>
                        <a href="/reject/${c._id}" class="btn btn-sm btn-warning" title="Reject">✗</a>
                        <a href="${waLink}" target="_blank" class="btn btn-sm btn-success" style="background-color: #25D366; border: none;" title="WhatsApp"><i class="bi bi-whatsapp"></i></a>
                        <a href="/delete/${c._id}" class="btn btn-sm btn-danger" title="Delete">🗑</a>
                    </div>
                </td>
            </tr>`;
        });

        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin Dashboard & CRM</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
            <style>
                .crm-modal-header { border-bottom: 2px solid #f0f0f0; }
                .crm-box { background: #f8f9fa; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
                .crm-label { font-size: 0.75rem; font-weight: bold; color: #6c757d; text-transform: uppercase; }
                .note-item { background: white; border: 1px solid #dee2e6; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
            </style>
        </head>
        <body class="bg-light p-4">
            <div class="container-fluid card shadow p-4">
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
                    <input name="search" value="${search}" class="form-control w-25" placeholder="Search patient name...">
                    <button class="btn btn-primary">Search</button>
                    <a href="/export" class="btn btn-success ms-auto">Export to Excel</a>
                </form>
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead class="table-dark">
                            <tr>
                                <th>Patient Name (Click for CRM)</th>
                                <th>Contact & Country</th>
                                <th>Dept & Source</th>
                                <th>Preferred Appt</th>
                                <th>Submitted On</th>
                                <th>Status</th>
                                <th>File</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="8" class="text-center">No records found</td></tr>'}</tbody>
                    </table>
                </div>
                <div class="mt-3">
                    <a href="/admin?page=${page - 1}" class="btn btn-sm btn-secondary ${page <= 1 ? 'disabled' : ''}">Prev</a>
                    <span>Page ${page}</span>
                    <a href="/admin?page=${page + 1}" class="btn btn-sm btn-secondary">Next</a>
                </div>
            </div>

            <div class="modal fade" id="crmModal" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header crm-modal-header p-4">
                            <div>
                                <h4 class="modal-title fw-bold" id="m_name">Patient Name</h4>
                                <small class="text-muted" id="m_sub">phone • email</small>
                            </div>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body p-4">
                            <div class="row">
                                <div class="col-md-6 border-end pe-4">
                                    <h5 class="fw-bold mb-3">Patient Details</h5>
                                    <div class="row g-2 mb-4">
                                        <div class="col-6"><div class="crm-box"><div class="crm-label">Name</div><div id="m_name2"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><div class="crm-label">Phone</div><div id="m_phone"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><div class="crm-label">Email</div><div id="m_email"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><div class="crm-label">Status</div><div id="m_status" class="fw-bold"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><div class="crm-label">Preferred Appt</div><div id="m_appt"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><div class="crm-label">Concern</div><div id="m_concern"></div></div></div>
                                    </div>

                                    <h5 class="fw-bold mb-3">Quick CRM Actions</h5>
                                    <form id="crmForm" method="POST">
                                        <div class="crm-box border shadow-sm bg-white">
                                            <div class="row g-2 mb-3">
                                                <div class="col-6">
                                                    <label class="crm-label">Follow-up Date</label>
                                                    <input type="date" name="followUpDate" id="m_fDate" class="form-control form-control-sm">
                                                </div>
                                                <div class="col-6">
                                                    <label class="crm-label">Follow-up Time</label>
                                                    <input type="time" name="followUpTime" id="m_fTime" class="form-control form-control-sm">
                                                </div>
                                                <div class="col-12 mt-2">
                                                    <label class="crm-label">Lead Stage</label>
                                                    <select name="leadStage" id="m_stage" class="form-select form-select-sm">
                                                        <option>New Lead</option>
                                                        <option>Follow-up Pending</option>
                                                        <option>Contacted - No Answer</option>
                                                        <option>Reports Pending</option>
                                                        <option>Doctor Review Pending</option>
                                                        <option>Converted / Closed</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="d-flex gap-2">
                                                <button type="submit" class="btn btn-primary btn-sm flex-grow-1">Save Follow-up</button>
                                                <a href="#" id="m_waBtn" target="_blank" class="btn btn-success btn-sm flex-grow-1">Open WhatsApp</a>
                                            </div>
                                        </div>
                                    </form>
                                </div>

                                <div class="col-md-6 ps-4">
                                    <h5 class="fw-bold mb-3">Notes</h5>
                                    <div id="notesContainer" style="max-height: 250px; overflow-y: auto;" class="mb-3 pr-2">
                                        </div>

                                    <form id="noteForm" method="POST" class="crm-box border shadow-sm bg-white">
                                        <label class="crm-label">Add Note</label>
                                        <textarea name="noteText" class="form-control form-control-sm mb-2" rows="3" placeholder="Type notes here..." required></textarea>
                                        <button type="submit" class="btn btn-primary btn-sm w-100">Save Note</button>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script>
                // This function is triggered when a patient name is clicked
                function openCRMModal(id, name, phone, email, status, date, time, concern, leadStage, fDate, fTime, notesData, waLink) {
                    document.getElementById('m_name').innerText = name;
                    document.getElementById('m_sub').innerText = phone + ' • ' + (email !== 'undefined' ? email : 'No email');
                    document.getElementById('m_name2').innerText = name;
                    document.getElementById('m_phone').innerText = phone;
                    document.getElementById('m_email').innerText = email !== 'undefined' ? email : 'NA';
                    document.getElementById('m_status').innerText = status.toUpperCase();
                    document.getElementById('m_appt').innerText = (date !== 'undefined' ? date : '') + ' ' + (time !== 'undefined' ? time : '');
                    document.getElementById('m_concern').innerText = concern;
                    
                    document.getElementById('m_fDate').value = fDate;
                    document.getElementById('m_fTime').value = fTime;
                    document.getElementById('m_stage').value = leadStage;
                    document.getElementById('m_waBtn').href = waLink;

                    // Set form action URLs to include the specific patient ID
                    document.getElementById('crmForm').action = '/admin/crm/' + id;
                    document.getElementById('noteForm').action = '/admin/note/' + id;

                    // Render Notes
                    const notesContainer = document.getElementById('notesContainer');
                    notesContainer.innerHTML = '';
                    const notes = JSON.parse(decodeURIComponent(notesData));
                    if(notes.length === 0) {
                        notesContainer.innerHTML = '<p class="text-muted small">No notes added yet.</p>';
                    } else {
                        notes.forEach(n => {
                            const d = new Date(n.createdAt);
                            notesContainer.innerHTML += \`
                                <div class="note-item shadow-sm">
                                    <div class="d-flex justify-content-between mb-1">
                                        <strong style="font-size:0.8rem;">Admin Note</strong>
                                        <small class="text-muted" style="font-size:0.75rem;">\${d.toLocaleDateString()} • \${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small>
                                    </div>
                                    <div style="font-size:0.9rem;">\${n.text}</div>
                                </div>
                            \`;
                        });
                    }

                    new bootstrap.Modal(document.getElementById('crmModal')).show();
                }
            </script>
        </body>
        </html>`);
    } catch (err) {
        res.status(500).send("Dashboard Error: " + err.message);
    }
});

////////////////////////////////////////////////////
// NEW CRM ROUTES (SAVE NOTES & UPDATES)
////////////////////////////////////////////////////
app.post('/admin/note/:id', isAdmin, async (req, res) => {
    try {
        await Contact.findByIdAndUpdate(req.params.id, {
            $push: { notes: { text: req.body.noteText } }
        });
        res.redirect('/admin');
    } catch (e) { res.redirect('/admin'); }
});

app.post('/admin/crm/:id', isAdmin, async (req, res) => {
    try {
        await Contact.findByIdAndUpdate(req.params.id, {
            followUpDate: req.body.followUpDate,
            followUpTime: req.body.followUpTime,
            leadStage: req.body.leadStage
        });
        res.redirect('/admin');
    } catch (e) { res.redirect('/admin'); }
});


////////////////////////////////////////////////////
// STATUS UPDATES & GOOGLE WEBHOOK EMAILS
////////////////////////////////////////////////////
app.get('/approve/:id', isAdmin, async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(req.params.id, { status: "Approved" }, { returnDocument: 'after' });
        if (contact.email) {
            await fetch('https://script.google.com/macros/s/AKfycbyelrW9KIEiX-uuD6CZtkRzZqaCEFOzyl3bbnyaPYsriypnchpNnAFzvwHKW5mv_rah/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: contact.email,
                    subject: "Appointment Approved - Surgical Route",
                    html: `<p>Dear ${contact.name}, your appointment for ${contact.department} on ${contact.date || 'your requested date'} has been officially approved. We will contact you shortly with further details.</p>`
                })
            });
        }
        res.redirect('/admin');
    } catch (e) { res.redirect('/admin'); }
});

app.get('/reject/:id', isAdmin, async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(req.params.id, { status: "Rejected" }, { returnDocument: 'after' });
        if (contact.email) {
            await fetch('https://script.google.com/macros/s/AKfycbyelrW9KIEiX-uuD6CZtkRzZqaCEFOzyl3bbnyaPYsriypnchpNnAFzvwHKW5mv_rah/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: contact.email,
                    subject: "Appointment Update - Surgical Route",
                    html: `<p>Dear ${contact.name}, we regret to inform you that we cannot proceed with your appointment at this time. Please contact us for further assistance.</p>`
                })
            });
        }
        res.redirect('/admin');
    } catch (e) { res.redirect('/admin'); }
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

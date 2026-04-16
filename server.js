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
// SCHEMA (CRM FIELDS)
////////////////////////////////////////////////////
const contactSchema = new mongoose.Schema({
    name: String, email: String, phone: String, country: String,
    department: String, message: String, report: String, source: String,
    date: String, time: String, status: { type: String, default: "Pending" },
    
    // CRM FIELDS
    leadStage: { type: String, default: "New Lead" },
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
        const filter = req.query.filter || "";
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // Build Database Query
        let query = { name: { $regex: search, $options: 'i' } };
        
        // FILTER LOGIC: If user clicked the Follow-up button, only show leads with a date set
        if (filter === 'followup') {
            query.followUpDate = { $exists: true, $ne: "" };
        }

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

            const safeNotes = encodeURIComponent(JSON.stringify(c.notes));
            const safeConcern = c.message ? c.message.replace(/'/g, "\\'") : 'NA';

            let stageBadge = "bg-secondary";
            if(c.leadStage === "New Lead") stageBadge = "bg-primary";
            if(c.leadStage === "Follow-up Pending") stageBadge = "bg-warning text-dark";
            if(c.leadStage === "Converted / Closed") stageBadge = "bg-success";

            let followUpDisplay = '<span class="text-muted small">Not scheduled</span>';
            if (c.followUpDate) {
                followUpDisplay = `<span class="text-primary fw-bold">📅 ${c.followUpDate}</span><br><span class="text-danger small">⏰ ${c.followUpTime || 'Time not set'}</span>`;
            }

            let latestNotePreview = "";
            if (c.notes && c.notes.length > 0) {
                const lastNote = c.notes[c.notes.length - 1].text;
                const shortNote = lastNote.length > 35 ? lastNote.substring(0, 35) + '...' : lastNote;
                latestNotePreview = `<br><div class="mt-1 p-1 bg-light border rounded small text-muted" title="${lastNote}">📝 ${shortNote}</div>`;
            }

            rows += `
            <tr>
                <td>
                    <a href="#" class="text-primary text-decoration-none fs-6" onclick="openCRMModal('${c._id}', '${c.name}', '${c.phone}', '${c.email}', '${c.status}', '${c.date}', '${c.time}', '${safeConcern}', '${c.leadStage}', '${c.followUpDate || ''}', '${c.followUpTime || ''}', '${safeNotes}', '${waLink}')">
                        <strong>${c.name}</strong>
                    </a>
                    <br><small>${c.email || '-'}</small>
                </td>
                <td>${c.phone}<br><small class="text-muted">${c.country}</small></td>
                <td><strong>${c.department}</strong><br><small class="text-muted text-truncate d-inline-block" style="max-width: 150px;">${c.message || 'No details'}</small></td>
                <td><small>Submit: ${submittedDate}</small><br><small>Appt: <strong>${c.date || 'N/A'}</strong></small></td>
                <td>
                    <span class="badge bg-${c.status === "Approved" ? "success" : c.status === "Rejected" ? "danger" : "warning"} mb-1">${c.status}</span><br>
                    <span class="badge ${stageBadge}"><i class="bi bi-funnel me-1"></i>${c.leadStage}</span>
                </td>
                <td>
                    ${followUpDisplay}
                    ${latestNotePreview}
                </td>
                <td>
                    <div class="d-flex flex-column gap-1">
                        <a href="${waLink}" target="_blank" class="btn btn-sm btn-success" style="background-color: #25D366; border: none; font-size: 0.75rem;" title="WhatsApp"><i class="bi bi-whatsapp"></i> Chat</a>
                        ${c.report ? `<a target="_blank" href="/uploads/${c.report}" class="btn btn-sm btn-outline-primary" style="font-size: 0.75rem;"><i class="bi bi-file-earmark-medical"></i> Report</a>` : ''}
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
                body { background-color: #f4f6f9; }
                .crm-modal-header { border-bottom: 2px solid #f0f0f0; }
                .crm-box { background: #fcfcfc; border: 1px solid #e9ecef; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
                .crm-label { font-size: 0.65rem; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; display: block; }
                .table th { font-size: 0.85rem; text-transform: uppercase; color: #6c757d; background-color: #e9ecef; }
                
                /* Styled Inputs for the modern look */
                .styled-input-box { background: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; }
                .styled-input-box input, .styled-input-box select { border: none; background: transparent; padding: 0; outline: none; width: 100%; box-shadow: none; font-weight: 500; color: #333; }
                .styled-input-box input:focus, .styled-input-box select:focus { border: none; box-shadow: none; }
                
                #notesContainer::-webkit-scrollbar { width: 6px; }
                #notesContainer::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
                #notesContainer::-webkit-scrollbar-thumb { background: #ccc; border-radius: 10px; }
            </style>
        </head>
        <body class="p-4">
            <div class="container-fluid bg-white rounded shadow-sm p-4 border-top border-primary border-4">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h3 class="fw-bold m-0"><i class="bi bi-heart-pulse text-primary me-2"></i>Surgical Route CRM</h3>
                    <a href="/logout" class="btn btn-outline-danger btn-sm">Logout</a>
                </div>
                
                <div class="row g-3 mb-4 text-center">
                    <div class="col-md-3"><div class="p-3 bg-primary bg-opacity-10 text-primary border border-primary rounded fw-bold">Total Inquiries: ${total}</div></div>
                    <div class="col-md-3"><div class="p-3 bg-warning bg-opacity-10 text-warning border border-warning rounded fw-bold">Pending Review: ${pending}</div></div>
                    <div class="col-md-3"><div class="p-3 bg-success bg-opacity-10 text-success border border-success rounded fw-bold">Approved: ${approved}</div></div>
                    <div class="col-md-3"><div class="p-3 bg-danger bg-opacity-10 text-danger border border-danger rounded fw-bold">Rejected: ${rejected}</div></div>
                </div>
                
                <form method="GET" class="d-flex gap-2 mb-3 align-items-center bg-light p-3 rounded border">
                    <input name="search" value="${search}" class="form-control w-25" placeholder="Search patient name...">
                    <button type="submit" class="btn btn-primary">Search</button>
                    
                    <div class="ms-3 border-start ps-3 d-flex gap-2">
                        <a href="/admin?filter=followup" class="btn btn-warning fw-bold text-dark"><i class="bi bi-calendar-check me-1"></i>Scheduled Follow-ups</a>
                        <a href="/admin" class="btn btn-outline-secondary">Clear Filter</a>
                    </div>

                    <a href="/export" class="btn btn-success ms-auto"><i class="bi bi-file-earmark-excel me-1"></i>Export Data</a>
                </form>

                <div class="table-responsive border rounded">
                    <table class="table table-hover align-middle mb-0">
                        <thead>
                            <tr>
                                <th>Patient Name</th>
                                <th>Contact Details</th>
                                <th>Dept & Concern</th>
                                <th>Dates</th>
                                <th>Status & Stage</th>
                                <th>Next Follow-up & Note</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="7" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-1 d-block mb-2"></i>No patients found</td></tr>'}</tbody>
                    </table>
                </div>
                
                <div class="mt-4 d-flex justify-content-between align-items-center">
                    <span class="text-muted small">Showing page ${page}</span>
                    <div class="btn-group">
                        <a href="/admin?page=${page - 1}${filter ? '&filter='+filter : ''}" class="btn btn-sm btn-outline-primary ${page <= 1 ? 'disabled' : ''}">Previous</a>
                        <a href="/admin?page=${page + 1}${filter ? '&filter='+filter : ''}" class="btn btn-sm btn-outline-primary">Next</a>
                    </div>
                </div>
            </div>

            <div class="modal fade" id="crmModal" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content border-0 shadow-lg">
                        <div class="modal-header crm-modal-header p-4 bg-white border-bottom">
                            <div>
                                <h4 class="modal-title fw-bold text-dark" id="m_name">Patient Name</h4>
                                <small class="text-muted" id="m_sub">phone • email</small>
                            </div>
                            <div class="ms-auto me-3 d-flex gap-2">
                                <a id="m_approveBtn" href="#" class="btn btn-success btn-sm"><i class="bi bi-check-circle me-1"></i>Approve</a>
                                <a id="m_rejectBtn" href="#" class="btn btn-danger btn-sm"><i class="bi bi-x-circle me-1"></i>Reject</a>
                                <a id="m_deleteBtn" href="#" class="btn btn-outline-danger btn-sm" onclick="return confirm('Delete this patient?');"><i class="bi bi-trash"></i></a>
                            </div>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body p-4 bg-white">
                            <div class="row">
                                <div class="col-md-6 border-end pe-4">
                                    <h5 class="fw-bold mb-3 text-dark">Patient Details</h5>
                                    <div class="row g-2 mb-4">
                                        <div class="col-6"><div class="crm-box"><span class="crm-label">Name</span><div id="m_name2" class="text-dark"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><span class="crm-label">Phone</span><div id="m_phone" class="text-dark"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><span class="crm-label">Email</span><div id="m_email" class="text-dark"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><span class="crm-label">Status</span><div id="m_status" class="fw-bold text-dark"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><span class="crm-label">Preferred Appt</span><div id="m_appt" class="text-dark"></div></div></div>
                                        <div class="col-6"><div class="crm-box"><span class="crm-label">Concern</span><div id="m_concern" class="text-dark"></div></div></div>
                                    </div>

                                    <h5 class="fw-bold mb-3 text-dark text-uppercase fs-6 text-muted">Quick CRM Actions</h5>
                                    <form id="crmForm" method="POST">
                                        <div class="row g-2 mb-3">
                                            <div class="col-6">
                                                <div class="styled-input-box">
                                                    <span class="crm-label">Follow-up Date</span>
                                                    <input type="date" name="followUpDate" id="m_fDate">
                                                </div>
                                            </div>
                                            <div class="col-6">
                                                <div class="styled-input-box">
                                                    <span class="crm-label">Follow-up Time</span>
                                                    <input type="time" name="followUpTime" id="m_fTime">
                                                </div>
                                            </div>
                                            <div class="col-12 mt-2">
                                                <div class="styled-input-box">
                                                    <span class="crm-label">Lead Stage</span>
                                                    <select name="leadStage" id="m_stage">
                                                        <option>New Lead</option>
                                                        <option>Follow-up Pending</option>
                                                        <option>Contacted - No Answer</option>
                                                        <option>Reports Pending</option>
                                                        <option>Doctor Review Pending</option>
                                                        <option>Converted / Closed</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="d-flex gap-2">
                                            <button type="submit" class="btn btn-primary fw-bold px-4" style="background-color: #1a56db; border:none;">Save Follow-up</button>
                                            <a href="#" id="m_waBtn" target="_blank" class="btn btn-light border fw-bold text-dark px-4">Open WhatsApp</a>
                                        </div>
                                    </form>
                                </div>

                                <div class="col-md-6 ps-4">
                                    <h5 class="fw-bold mb-3 text-dark">Notes</h5>
                                    
                                    <form id="noteForm" method="POST" class="mb-3">
                                        <div class="styled-input-box bg-light mb-3">
                                            <span class="crm-label mb-1">Add Note</span>
                                            <textarea name="noteText" class="form-control form-control-sm border-0 bg-transparent shadow-none p-0" rows="3" placeholder="Type notes here..." required></textarea>
                                        </div>
                                        <div class="d-flex gap-2">
                                            <button type="submit" class="btn btn-primary fw-bold px-4" style="background-color: #1a56db; border:none;">Save Note</button>
                                            <button type="button" id="toggleHistoryBtn" class="btn btn-light border fw-bold text-dark px-4" onclick="toggleHistory()">View History</button>
                                        </div>
                                    </form>

                                    <div id="historySection" style="display: none;">
                                        <hr class="text-muted opacity-25">
                                        <div id="notesContainer" style="max-height: 280px; overflow-y: auto;" class="pe-2">
                                            </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script>
                let isHistoryVisible = false;
                function toggleHistory() {
                    const section = document.getElementById('historySection');
                    const btn = document.getElementById('toggleHistoryBtn');
                    isHistoryVisible = !isHistoryVisible;
                    
                    if (isHistoryVisible) {
                        section.style.display = 'block';
                        btn.innerText = 'Hide History';
                    } else {
                        section.style.display = 'none';
                        btn.innerText = 'View History';
                    }
                }

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

                    document.getElementById('crmForm').action = '/admin/crm/' + id;
                    document.getElementById('noteForm').action = '/admin/note/' + id;
                    
                    document.getElementById('m_approveBtn').href = '/approve/' + id;
                    document.getElementById('m_rejectBtn').href = '/reject/' + id;
                    document.getElementById('m_deleteBtn').href = '/delete/' + id;

                    isHistoryVisible = false;
                    document.getElementById('historySection').style.display = 'none';
                    document.getElementById('toggleHistoryBtn').innerText = 'View History';

                    const notesContainer = document.getElementById('notesContainer');
                    notesContainer.innerHTML = '';
                    const notes = JSON.parse(decodeURIComponent(notesData));
                    
                    if(notes.length === 0) {
                        notesContainer.innerHTML = '<div class="text-center text-muted small py-3">No history available.</div>';
                    } else {
                        notes.slice().reverse().forEach(n => {
                            const d = new Date(n.createdAt);
                            notesContainer.innerHTML += \`
                                <div class="bg-white border rounded p-3 mb-2 shadow-sm">
                                    <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
                                        <span class="text-muted small fw-bold">Admin Note</span>
                                        <small class="text-muted" style="font-size:0.75rem;">\${d.toLocaleDateString()} • \${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small>
                                    </div>
                                    <p style="font-size:0.85rem; color: #444; margin:0; white-space: pre-wrap;">\${n.text}</p>
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
        { header: 'Time', key: 'time' }, { header: 'Status', key: 'status' },
        { header: 'Stage', key: 'leadStage' }
    ];
    contacts.forEach(c => worksheet.addRow(c));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=appointments.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

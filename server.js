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
// SCHEMA
////////////////////////////////////////////////////
const contactSchema = new mongoose.Schema({
    name: String, email: String, phone: String, country: String,
    department: String, message: String, report: String, source: String,
    date: String, time: String, status: { type: String, default: "Pending" },
    
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

        let query = { name: { $regex: search, $options: 'i' } };
        if (filter === 'followup') query.followUpDate = { $exists: true, $ne: "" };

        const contacts = await Contact.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
        const total = await Contact.countDocuments();
        const pending = await Contact.countDocuments({ status: "Pending" });
        const approved = await Contact.countDocuments({ status: "Approved" });
        const rejected = await Contact.countDocuments({ status: "Rejected" });

        let rows = "";
        contacts.forEach(c => {
            const submittedDate = new Date(c.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
            const submittedTime = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const cleanPhone = c.phone.replace(/[^0-9]/g, ''); 
            const waMsg = encodeURIComponent(`Hello ${c.name}, this is Surgical Route reaching out regarding your recent medical inquiry.`);
            const waLink = `https://wa.me/${cleanPhone}?text=${waMsg}`;

            const safeNotes = encodeURIComponent(JSON.stringify(c.notes));
            const safeConcern = c.message ? c.message.replace(/'/g, "\\'") : 'NA';

            let statusBadge = '';
            if(c.status === "Approved") statusBadge = `<span class="badge rounded-pill bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-3 py-2 fw-semibold"><i class="bi bi-check-circle-fill me-1"></i>Approved</span>`;
            else if(c.status === "Rejected") statusBadge = `<span class="badge rounded-pill bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 px-3 py-2 fw-semibold"><i class="bi bi-x-circle-fill me-1"></i>Rejected</span>`;
            else statusBadge = `<span class="badge rounded-pill bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 px-3 py-2 fw-semibold"><i class="bi bi-clock-fill me-1"></i>Pending</span>`;

            let stageBadge = `<span class="badge rounded-pill bg-light text-secondary border px-3 py-2 fw-medium mt-2 d-inline-block"><i class="bi bi-funnel me-1"></i>${c.leadStage}</span>`;
            if(c.leadStage === "New Lead") stageBadge = `<span class="badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-3 py-2 fw-medium mt-2 d-inline-block"><i class="bi bi-funnel me-1"></i>${c.leadStage}</span>`;
            if(c.leadStage === "Follow-up Pending") stageBadge = `<span class="badge rounded-pill bg-info bg-opacity-10 text-info border border-info border-opacity-25 px-3 py-2 fw-medium mt-2 d-inline-block"><i class="bi bi-funnel me-1"></i>${c.leadStage}</span>`;
            if(c.leadStage === "Converted / Closed") stageBadge = `<span class="badge rounded-pill bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-3 py-2 fw-medium mt-2 d-inline-block"><i class="bi bi-funnel me-1"></i>${c.leadStage}</span>`;

            let followUpDisplay = '<span class="text-muted small fw-medium"><i class="bi bi-calendar-x me-1"></i>Not scheduled</span>';
            if (c.followUpDate) {
                followUpDisplay = `<div class="d-flex align-items-center gap-2"><div class="bg-primary bg-opacity-10 text-primary p-2 rounded"><i class="bi bi-calendar-event"></i></div><div><span class="text-dark fw-bold d-block" style="font-size:0.85rem;">${c.followUpDate}</span><span class="text-danger fw-bold" style="font-size:0.75rem;">${c.followUpTime || 'Time not set'}</span></div></div>`;
            }

            let latestNotePreview = "";
            if (c.notes && c.notes.length > 0) {
                const lastNote = c.notes[c.notes.length - 1].text;
                const shortNote = lastNote.length > 35 ? lastNote.substring(0, 35) + '...' : lastNote;
                latestNotePreview = `<div class="mt-2 p-2 bg-light border rounded text-muted" style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.75rem;" title="${lastNote}"><i class="bi bi-chat-left-text me-1"></i>${shortNote}</div>`;
            }

            const initial = c.name ? c.name.charAt(0).toUpperCase() : '?';

            rows += `
            <tr class="align-middle table-row-hover">
                <td class="ps-4 py-3">
                    <div class="d-flex align-items-center">
                        <div class="patient-avatar shadow-sm me-3">${initial}</div>
                        <div>
                            <a href="#" class="text-dark text-decoration-none fs-6 fw-bold crm-link" onclick="openCRMModal('${c._id}', '${c.name}', '${c.phone}', '${c.email}', '${c.status}', '${c.date}', '${c.time}', '${safeConcern}', '${c.leadStage}', '${c.followUpDate || ''}', '${c.followUpTime || ''}', '${safeNotes}', '${waLink}')">
                                ${c.name}
                            </a>
                            <br><span class="text-muted" style="font-size:0.8rem;">${c.email || 'No email provided'}</span>
                        </div>
                    </div>
                </td>
                <td class="py-3">
                    <span class="fw-semibold text-dark" style="font-size:0.9rem;">${c.phone}</span><br>
                    <span class="text-muted" style="font-size:0.8rem;">${c.country}</span>
                </td>
                <td class="py-3">
                    <span class="fw-semibold text-dark" style="font-size:0.9rem;">${c.department}</span><br>
                    <span class="text-muted text-truncate d-inline-block" style="max-width: 160px; font-size:0.8rem;" title="${c.message || 'No details'}">${c.message || 'No concern details provided'}</span>
                </td>
                <td class="py-3">
                    <div class="d-flex flex-column gap-1">
                        <span style="font-size:0.8rem;" class="text-muted">Inquiry: <span class="fw-semibold text-dark">${submittedDate}</span> <span class="text-muted">${submittedTime}</span></span>
                        <span style="font-size:0.8rem;" class="text-muted">Appt: <span class="fw-bold text-primary">${c.date || 'N/A'}</span> <span class="text-primary fw-semibold">${c.time || ''}</span></span>
                    </div>
                </td>
                <td class="py-3">
                    ${statusBadge}<br>${stageBadge}
                </td>
                <td class="py-3">
                    ${followUpDisplay}
                    ${latestNotePreview}
                </td>
                <td class="pe-4 py-3 text-end">
                    <div class="d-flex flex-column gap-2 align-items-end w-100" style="max-width: 140px; margin-left: auto;">
                        <a href="${waLink}" target="_blank" class="btn btn-action-main w-100 text-start shadow-sm"><i class="bi bi-whatsapp"></i> Chat</a>
                        <div class="d-flex gap-2 w-100">
                            <a href="/approve/${c._id}" class="btn btn-action-icon text-success flex-grow-1 shadow-sm" title="Approve"><i class="bi bi-check-lg"></i></a>
                            <a href="/reject/${c._id}" class="btn btn-action-icon text-warning flex-grow-1 shadow-sm" title="Reject"><i class="bi bi-x-lg"></i></a>
                            <a href="/delete/${c._id}" class="btn btn-action-icon text-danger flex-grow-1 shadow-sm" title="Delete" onclick="return confirm('Delete this lead permanently?');"><i class="bi bi-trash3"></i></a>
                        </div>
                        ${c.report ? `<a target="_blank" href="/uploads/${c.report}" class="btn btn-action-secondary w-100 mt-1 shadow-sm"><i class="bi bi-file-earmark-medical"></i> View Report</a>` : ''}
                    </div>
                </td>
            </tr>`;
        });

        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Surgical Route CRM</title>
            
            <link rel="icon" type="image/png" href="/logo.png">
            
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
            <style>
                :root {
                    --bg-main: #f8fafc;
                    --bg-card: #ffffff;
                    --text-main: #0f172a;
                    --text-muted: #64748b;
                    --border-color: #e2e8f0;
                    --primary: #2563eb;
                    --primary-hover: #1d4ed8;
                }
                body { background-color: var(--bg-main); font-family: 'Inter', sans-serif; color: var(--text-main); -webkit-font-smoothing: antialiased; }
                
                .saas-navbar { background-color: var(--bg-card); border-bottom: 1px solid var(--border-color); padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 1000; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);}
                .brand { font-weight: 800; font-size: 1.25rem; color: var(--text-main); display: flex; align-items: center; gap: 8px;}
                .logout-btn { color: var(--text-muted); text-decoration: none; font-weight: 600; font-size: 0.9rem; padding: 8px 16px; border-radius: 8px; transition: 0.2s;}
                .logout-btn:hover { background-color: #f1f5f9; color: var(--text-main); }

                .page-header { padding: 32px; display: flex; justify-content: space-between; align-items: flex-end; }
                .page-title h1 { font-weight: 800; font-size: 1.8rem; margin: 0; color: var(--text-main); letter-spacing: -0.5px;}
                .page-title p { color: var(--text-muted); margin: 4px 0 0 0; font-size: 0.95rem; }

                .stat-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display: flex; align-items: center; gap: 16px; transition: 0.2s; box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);}
                .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06); }
                .stat-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
                .icon-primary { background: #eff6ff; color: #3b82f6; }
                .icon-warning { background: #fffbeb; color: #f59e0b; }
                .icon-success { background: #ecfdf5; color: #10b981; }
                .icon-danger { background: #fef2f2; color: #ef4444; }
                .stat-info h3 { font-size: 1.5rem; font-weight: 800; margin: 0; line-height: 1.2; color: var(--text-main);}
                .stat-info p { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 0;}

                .table-wrapper { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); margin: 0 32px 32px 32px; overflow: hidden; }
                .table-toolbar { padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background-color: #ffffff;}
                
                .search-box { position: relative; width: 300px; }
                .search-box input { padding: 8px 16px 8px 36px; border-radius: 8px; border: 1px solid var(--border-color); width: 100%; font-size: 0.9rem; outline: none; transition: 0.2s;}
                .search-box input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
                .search-box i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }

                .table { margin-bottom: 0; }
                .table thead th { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); background-color: #f8fafc; padding: 12px 16px; border-bottom: 1px solid var(--border-color); letter-spacing: 0.5px;}
                .table tbody td { border-bottom: 1px solid var(--border-color); }
                .table-row-hover:hover { background-color: #f8fafc; transition: 0.2s;}
                
                .patient-avatar { width: 40px; height: 40px; border-radius: 50%; background: #eff6ff; color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.1rem; border: 1px solid #bfdbfe; }
                .crm-link { transition: color 0.2s; }
                .crm-link:hover { color: var(--primary) !important; text-decoration: underline !important; }

                .btn-action-main { background-color: #25D366; color: white; border-radius: 6px; padding: 6px 12px; font-size: 0.75rem; font-weight: 600; text-decoration: none; transition: 0.2s; display: inline-block;}
                .btn-action-main:hover { background-color: #128C7E; color: white; }
                .btn-action-secondary { background-color: #f1f5f9; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 12px; font-size: 0.75rem; font-weight: 600; text-decoration: none; transition: 0.2s; text-align: center;}
                .btn-action-secondary:hover { background-color: #e2e8f0; }
                .btn-action-icon { background-color: #ffffff; border: 1px solid var(--border-color); border-radius: 6px; width: 100%; height: 28px; display: flex; align-items: center; justify-content: center; transition: 0.2s; text-decoration:none;}
                .btn-action-icon:hover { background-color: #f8fafc; }

                .modal-content { border-radius: 16px; border: none; overflow: hidden; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1); }
                .crm-section-title { font-size: 1.15rem; font-weight: 700; color: #1e293b; margin-bottom: 1.25rem; }
                .crm-sub-title { font-size: 0.8rem; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1.5rem; margin-bottom: 1rem; }
                .info-box { background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 12px 16px; height: 100%; }
                .info-label { font-size: 0.65rem; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: block; }
                .info-value { font-size: 0.95rem; color: #0f172a; font-weight: 500; margin: 0; word-wrap: break-word;}
                .crm-input-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 16px; transition: border-color 0.2s;}
                .crm-input-box:focus-within { border-color: #cbd5e1; }
                .crm-input-box input, .crm-input-box select { border: none; background: transparent; padding: 0; width: 100%; font-size: 0.95rem; color: #0f172a; outline: none; box-shadow: none; font-weight: 500;}
                .note-textarea { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; width: 100%; resize: none; outline: none; font-size: 0.95rem; color: #334155; transition: 0.2s;}
                .note-textarea:focus { border-color: #94a3b8; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);}
                .note-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.02); cursor: pointer; transition: 0.2s; position: relative;}
                .note-card:hover { background-color: #f8fafc; border-color: #cbd5e1; }
                .note-header { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;}
                .note-text { font-size: 0.9rem; color: #334155; margin: 0; line-height: 1.6; word-break: break-word; overflow-wrap: break-word; }
                .dbl-click-hint { font-size: 0.6rem; color: #94a3b8; position: absolute; bottom: 6px; right: 12px; opacity: 0; transition: 0.2s; }
                .note-card:hover .dbl-click-hint { opacity: 1; }
                .btn-action { white-space: nowrap; font-size: 0.85rem; padding: 12px 8px; flex: 1; text-align: center; display: flex; align-items: center; justify-content: center; text-decoration: none;}
                .btn-blue { background-color: #2563eb; color: white; border: none; border-radius: 10px; transition: 0.2s; }
                .btn-blue:hover { background-color: #1d4ed8; color: white; }
                .btn-green { background-color: #16a34a; color: white; border: none; border-radius: 10px; transition: 0.2s; }
                .btn-green:hover { background-color: #15803d; color: white; }
                .btn-gray { background-color: #ffffff; color: #334155; border: 1px solid #e2e8f0; border-radius: 10px; transition: 0.2s; }
                .btn-gray:hover { background-color: #f8fafc; color: #0f172a;}
                #notesContainer::-webkit-scrollbar { width: 6px; }
                #notesContainer::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 10px; }
                #notesContainer::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            </style>
        </head>
        <body>
            <nav class="saas-navbar">
                <div class="brand">
                    <i class="bi bi-heart-pulse-fill text-primary fs-4"></i>
                    Surgical Route CRM
                </div>
                <a href="/logout" class="logout-btn"><i class="bi bi-box-arrow-right me-2"></i>Log out</a>
            </nav>

            <div class="page-header px-4 px-md-5">
                <div class="page-title">
                    <h1>Lead Management</h1>
                    <p>Track patient inquiries, update CRM stages, and schedule follow-ups.</p>
                </div>
                <div>
                    <a href="/export" class="btn btn-outline-secondary fw-bold bg-white shadow-sm"><i class="bi bi-download me-2"></i>Export Excel</a>
                </div>
            </div>

            <div class="px-4 px-md-5 mb-4">
                <div class="row g-4">
                    <div class="col-md-3">
                        <div class="stat-card">
                            <div class="stat-icon icon-primary"><i class="bi bi-people-fill"></i></div>
                            <div class="stat-info">
                                <p>Total Leads</p>
                                <h3>${total}</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-card">
                            <div class="stat-icon icon-warning"><i class="bi bi-hourglass-split"></i></div>
                            <div class="stat-info">
                                <p>Pending Review</p>
                                <h3>${pending}</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-card">
                            <div class="stat-icon icon-success"><i class="bi bi-check-circle-fill"></i></div>
                            <div class="stat-info">
                                <p>Approved</p>
                                <h3>${approved}</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-card">
                            <div class="stat-icon icon-danger"><i class="bi bi-x-circle-fill"></i></div>
                            <div class="stat-info">
                                <p>Rejected</p>
                                <h3>${rejected}</h3>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="table-wrapper">
                <div class="table-toolbar">
                    <form method="GET" class="d-flex gap-3 m-0 w-100">
                        <div class="search-box flex-grow-1" style="max-width: 400px;">
                            <i class="bi bi-search"></i>
                            <input type="text" name="search" value="${search}" placeholder="Search patient name..." onchange="this.form.submit()">
                        </div>
                        <div class="d-flex gap-2">
                            <a href="/admin?filter=followup" class="btn btn-light border fw-semibold text-dark shadow-sm"><i class="bi bi-calendar-check me-2 text-warning"></i>Scheduled Calls</a>
                            <a href="/admin" class="btn btn-light border fw-semibold text-muted">Clear</a>
                        </div>
                    </form>
                </div>

                <div class="table-responsive">
                    <table class="table">
                        <thead>
                            <tr>
                                <th class="ps-4">Patient Profile</th>
                                <th>Contact Info</th>
                                <th>Department</th>
                                <th>Timeline</th>
                                <th>Pipeline Stage</th>
                                <th>CRM Activity</th>
                                <th class="pe-4 text-end">Quick Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="7" class="text-center py-5 text-muted"><div class="py-5"><i class="bi bi-inbox text-secondary opacity-25" style="font-size: 4rem;"></i><h5 class="mt-3 text-dark fw-bold">No leads found</h5><p>There are no patients matching your criteria.</p></div></td></tr>'}</tbody>
                    </table>
                </div>
                
                <div class="px-4 py-3 border-top bg-light d-flex justify-content-between align-items-center">
                    <span class="text-muted fw-medium" style="font-size: 0.85rem;">Showing Page ${page}</span>
                    <div class="btn-group shadow-sm border rounded bg-white">
                        <a href="/admin?page=${page - 1}${filter ? '&filter='+filter : ''}" class="btn btn-sm btn-light border-0 text-dark fw-semibold px-3 py-2 ${page <= 1 ? 'disabled' : ''}">Previous</a>
                        <div class="border-start"></div>
                        <a href="/admin?page=${page + 1}${filter ? '&filter='+filter : ''}" class="btn btn-sm btn-light border-0 text-dark fw-semibold px-3 py-2">Next</a>
                    </div>
                </div>
            </div>

            <div class="modal fade" id="crmModal" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        
                        <div class="modal-header border-0 pb-0 pt-3 px-4">
                            <div class="ms-auto d-flex gap-2 pe-3">
                                <a id="modal_approveBtn" href="#" class="btn btn-sm btn-success fw-bold shadow-sm"><i class="bi bi-check-circle me-1"></i>Approve</a>
                                <a id="modal_rejectBtn" href="#" class="btn btn-sm btn-warning fw-bold text-dark shadow-sm"><i class="bi bi-x-circle me-1"></i>Reject</a>
                                <a id="modal_deleteBtn" href="#" class="btn btn-sm btn-danger fw-bold shadow-sm" onclick="return confirm('Are you sure you want to delete this patient?');"><i class="bi bi-trash"></i></a>
                            </div>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        
                        <div class="modal-body p-4 p-md-5 pt-2">
                            <div class="row h-100">
                                
                                <div class="col-md-6 border-end pe-md-4">
                                    <h5 class="crm-section-title">Patient Details</h5>
                                    
                                    <div class="row g-3 mb-2">
                                        <div class="col-6"><div class="info-box"><span class="info-label">NAME</span><p class="info-value" id="m_name2"></p></div></div>
                                        <div class="col-6"><div class="info-box"><span class="info-label">PHONE</span><p class="info-value" id="m_phone"></p></div></div>
                                        <div class="col-6"><div class="info-box"><span class="info-label">EMAIL</span><p class="info-value text-truncate" id="m_email"></p></div></div>
                                        <div class="col-6"><div class="info-box"><span class="info-label">STATUS</span><p class="info-value text-uppercase fw-bold" id="m_status"></p></div></div>
                                        <div class="col-6"><div class="info-box"><span class="info-label">PREFERRED APPT</span><p class="info-value" id="m_appt"></p></div></div>
                                        <div class="col-6"><div class="info-box"><span class="info-label">CONCERN</span><p class="info-value" id="m_concern"></p></div></div>
                                    </div>

                                    <h6 class="crm-sub-title">QUICK CRM ACTIONS</h6>
                                    
                                    <form id="crmForm" method="POST">
                                        <div class="row g-3 mb-4">
                                            <div class="col-6">
                                                <div class="crm-input-box">
                                                    <span class="info-label d-flex justify-content-between">FOLLOW-UP DATE <i class="bi bi-calendar3"></i></span>
                                                    <input type="date" name="followUpDate" id="m_fDate">
                                                </div>
                                            </div>
                                            <div class="col-6">
                                                <div class="crm-input-box">
                                                    <span class="info-label d-flex justify-content-between">FOLLOW-UP TIME <i class="bi bi-clock"></i></span>
                                                    <input type="time" name="followUpTime" id="m_fTime">
                                                </div>
                                            </div>
                                            <div class="col-12">
                                                <div class="crm-input-box">
                                                    <span class="info-label d-flex justify-content-between">LEAD STAGE <i class="bi bi-chevron-down"></i></span>
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
                                            <button type="submit" class="btn btn-blue fw-bold btn-action shadow-sm">Save Follow-up</button>
                                            <a href="#" id="m_approveBtn" class="btn btn-green fw-bold btn-action shadow-sm">Update Status</a>
                                            <a href="#" id="m_waBtn" target="_blank" class="btn btn-gray fw-bold btn-action shadow-sm">Open WhatsApp</a>
                                        </div>
                                    </form>
                                </div>

                                <div class="col-md-6 ps-md-4 mt-4 mt-md-0 d-flex flex-column">
                                    <h5 class="crm-section-title">Notes</h5>
                                    
                                    <form id="noteForm" method="POST">
                                        <div class="mb-4">
                                            <span class="info-label mb-2">ADD NOTE</span>
                                            <textarea name="noteText" class="note-textarea" rows="4" placeholder="Type call summaries, patient requests, or next steps here..." required></textarea>
                                        </div>
                                        
                                        <div class="d-flex gap-2 mb-4">
                                            <button type="submit" class="btn btn-blue fw-bold btn-action shadow-sm">Save Note</button>
                                            <button type="button" id="toggleHistoryBtn" class="btn btn-gray fw-bold btn-action shadow-sm" onclick="toggleHistory()">View History</button>
                                        </div>
                                    </form>

                                    <div id="historySection" style="display: none;">
                                        <h6 class="info-label mb-3">PAST INTERACTIONS (Double-click card to expand)</h6>
                                        <div id="notesContainer" style="max-height: 250px; overflow-y: auto;" class="pe-2">
                                        </div>
                                    </div>
                                    
                                    <div class="dashed-activity mt-auto pt-3" style="border-top: 1px dashed var(--border-color);">
                                        <p class="mb-0 text-center text-muted" style="font-size: 0.75rem;"><strong>Activity:</strong> inquiry received &rarr; contacted &rarr; note added &rarr; follow-up scheduled</p>
                                    </div>
                                    
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal fade" id="fullNoteModal" tabindex="-1" style="z-index: 1060;">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content shadow-lg border-0" style="background-color: #f8fafc;">
                        <div class="modal-header border-bottom-0 pb-0">
                            <h5 class="modal-title fw-bold text-dark"><i class="bi bi-journal-text text-primary me-2"></i>Full Note Reading View</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body p-4">
                            <div class="bg-white p-4 rounded border shadow-sm">
                                <p id="fullNoteContent" style="white-space: pre-wrap; word-break: break-word; color: #1e293b; font-size: 0.95rem; line-height: 1.7; margin: 0;"></p>
                            </div>
                        </div>
                        <div class="modal-footer border-top-0 pt-0">
                            <span id="fullNoteDate" class="text-muted small me-auto fw-bold"></span>
                            <button type="button" class="btn btn-gray fw-bold px-4 py-2" data-bs-dismiss="modal">Close</button>
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

                function openFullNote(encodedText, encodedDate) {
                    document.getElementById('fullNoteContent').innerText = decodeURIComponent(encodedText);
                    document.getElementById('fullNoteDate').innerText = decodeURIComponent(encodedDate);
                    new bootstrap.Modal(document.getElementById('fullNoteModal')).show();
                }

                function openCRMModal(id, name, phone, email, status, date, time, concern, leadStage, fDate, fTime, notesData, waLink) {
                    document.getElementById('m_name2').innerText = name;
                    document.getElementById('m_phone').innerText = phone;
                    document.getElementById('m_email').innerText = email !== 'undefined' ? email : 'NA';
                    document.getElementById('m_status').innerText = status;
                    document.getElementById('m_appt').innerText = (date !== 'undefined' ? date : '') + ' ' + (time !== 'undefined' ? time : '');
                    document.getElementById('m_concern').innerText = concern;
                    
                    document.getElementById('m_fDate').value = fDate;
                    document.getElementById('m_fTime').value = fTime;
                    document.getElementById('m_stage').value = leadStage;
                    document.getElementById('m_waBtn').href = waLink;
                    
                    document.getElementById('crmForm').action = '/admin/crm/' + id;
                    document.getElementById('noteForm').action = '/admin/note/' + id;
                    
                    document.getElementById('m_approveBtn').href = '/approve/' + id;
                    document.getElementById('modal_approveBtn').href = '/approve/' + id;
                    document.getElementById('modal_rejectBtn').href = '/reject/' + id;
                    document.getElementById('modal_deleteBtn').href = '/delete/' + id;

                    isHistoryVisible = false;
                    document.getElementById('historySection').style.display = 'none';
                    document.getElementById('toggleHistoryBtn').innerText = 'View History';

                    const notesContainer = document.getElementById('notesContainer');
                    notesContainer.innerHTML = '';
                    const notes = JSON.parse(decodeURIComponent(notesData));
                    
                    if(notes.length === 0) {
                        notesContainer.innerHTML = '<div class="note-card text-center text-muted border-0 bg-transparent shadow-none" style="cursor: default;">No notes added yet.</div>';
                    } else {
                        notes.slice().reverse().forEach((n, index) => {
                            const d = new Date(n.createdAt);
                            const title = index === 0 ? "Latest Activity" : "Admin Note"; 
                            const displayDate = d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) + ' • ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                            
                            const safeTextContent = encodeURIComponent(n.text);
                            const safeDateContent = encodeURIComponent(displayDate);
                            
                            notesContainer.innerHTML += \`
                                <div class="note-card" ondblclick="openFullNote('\${safeTextContent}', '\${safeDateContent}')" title="Double-click to read full note">
                                    <div class="note-header">
                                        <span><i class="bi bi-record-circle text-primary me-1"></i> \${title}</span>
                                        <span>\${displayDate}</span>
                                    </div>
                                    <p class="note-text">\${n.text}</p>
                                    <span class="dbl-click-hint"><i class="bi bi-arrows-angle-expand me-1"></i>Double-click to expand</span>
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
// CRM ROUTES
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
// STATUS UPDATES
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

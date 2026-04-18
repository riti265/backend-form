const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();
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
// DARK THEME ADMIN PANEL & CRM
////////////////////////////////////////////////////
app.get('/admin', isAdmin, async (req, res) => {
    try {
        const search = req.query.search || "";
        const filter = req.query.filter || "";
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        let query = { name: { $regex: search, $options: 'i' } };
        if (filter === 'pending') query.status = "Pending";
        if (filter === 'approved') query.status = "Approved";

        const contacts = await Contact.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
        const total = await Contact.countDocuments();
        const pending = await Contact.countDocuments({ status: "Pending" });
        const approved = await Contact.countDocuments({ status: "Approved" });
        const scheduledTotal = await Contact.countDocuments({ followUpDate: { $exists: true, $ne: "" } });

        let rows = "";
        contacts.forEach(c => {
            const submittedDate = new Date(c.createdAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g, '-');
            const submittedTime = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const cleanPhone = c.phone.replace(/[^0-9]/g, ''); 
            const waMsg = encodeURIComponent(`Hello ${c.name}, this is Surgical Route reaching out regarding your recent medical inquiry.`);
            const waLink = `https://wa.me/${cleanPhone}?text=${waMsg}`;

            const safeNotes = encodeURIComponent(JSON.stringify(c.notes));
            const safeConcern = c.message ? c.message.replace(/'/g, "\\'") : 'NA';

            let statusBadge = '';
            if(c.status === "Approved") statusBadge = `<span class="status-badge badge-approved">Approved</span>`;
            else if(c.status === "Rejected") statusBadge = `<span class="status-badge badge-rejected">Rejected</span>`;
            else statusBadge = `<span class="status-badge badge-pending">Pending</span>`;

            let followUpDisplay = '<span class="text-secondary fst-italic" style="font-size:0.85rem;">Not scheduled</span>';
            if (c.followUpDate) {
                const fDate = new Date(c.followUpDate).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g, '-');
                followUpDisplay = `<span class="followup-date">${fDate}</span><br><span class="text-secondary" style="font-size:0.8rem;">${c.followUpTime || '00:00'}</span>`;
            }

            const reportDisplay = c.report 
                ? `<a target="_blank" href="/uploads/${c.report}" class="report-link"><i class="bi bi-file-earmark-medical-fill"></i> View File</a>` 
                : `<span class="text-secondary" style="font-size:0.85rem;">No File</span>`;

            rows += `
            <tr class="table-row">
                <td class="py-3 ps-3">
                    <a href="#" class="patient-name-link" onclick="openCRMModal('${c._id}', '${c.name}', '${c.phone}', '${c.email}', '${c.status}', '${c.date}', '${c.time}', '${safeConcern}', '${c.leadStage}', '${c.followUpDate || ''}', '${c.followUpTime || ''}', '${safeNotes}', '${waLink}')">${c.name}</a><br>
                    <span class="contact-info"><i class="bi bi-telephone-fill me-1"></i>${c.phone}</span><br>
                    <span class="contact-info"><i class="bi bi-envelope-fill me-1"></i>${c.email || 'N/A'}</span>
                </td>
                <td class="py-3">
                    <span class="text-white fw-bold" style="font-size:0.85rem;">${submittedDate}</span><br>
                    <span class="text-secondary" style="font-size:0.8rem;">${submittedTime}</span>
                </td>
                <td class="py-3">
                    ${followUpDisplay}
                </td>
                <td class="py-3">
                    ${reportDisplay}
                </td>
                <td class="py-3">
                    ${statusBadge}<br>
                    <span class="text-secondary" style="font-size:0.8rem; margin-top:4px; display:inline-block;">${c.leadStage}</span>
                </td>
                <td class="py-3">
                    <div class="d-flex gap-2">
                        <a href="#" class="btn-action btn-crm" onclick="openCRMModal('${c._id}', '${c.name}', '${c.phone}', '${c.email}', '${c.status}', '${c.date}', '${c.time}', '${safeConcern}', '${c.leadStage}', '${c.followUpDate || ''}', '${c.followUpTime || ''}', '${safeNotes}', '${waLink}')"><i class="bi bi-eye-fill me-1"></i> CRM</a>
                        <a href="/delete/${c._id}" class="btn-action btn-del" onclick="return confirm('Delete this lead?');"><i class="bi bi-trash-fill"></i></a>
                    </div>
                </td>
            </tr>`;
        });

        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Surgical Route Admin Dashboard</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
            <style>
                :root {
                    --bg-sidebar: #0f1523;
                    --bg-main: #161c2d;
                    --bg-card: #1f273b;
                    --text-main: #f8fafc;
                    --text-muted: #94a3b8;
                    --border-color: #2d3748;
                    --accent-blue: #3b82f6;
                    --accent-green: #10b981;
                    --accent-orange: #f59e0b;
                }
                body { background-color: var(--bg-main); color: var(--text-main); font-family: 'Inter', sans-serif; overflow-x: hidden; }
                
                /* Layout */
                .app-container { display: flex; min-height: 100vh; }
                .sidebar { width: 260px; background-color: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; position: fixed; height: 100vh; left: 0; top: 0; }
                .main-content { flex: 1; margin-left: 260px; padding: 30px; }

                /* Sidebar */
                .brand { padding: 30px 20px; text-align: center; border-bottom: 1px solid var(--border-color); }
                .brand-icon { width: 50px; height: 50px; background: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto; border: 2px solid var(--accent-green); }
                .brand-icon i { color: var(--accent-green); font-size: 1.5rem; }
                .brand h4 { font-weight: 700; font-size: 1.2rem; margin: 0; color: #fff; }
                .brand p { font-size: 0.75rem; color: var(--text-muted); margin: 0; }
                
                .nav-section { padding: 20px 0; }
                .nav-title { font-size: 0.7rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px; padding: 0 25px; margin-bottom: 10px; }
                .nav-link { display: flex; align-items: center; justify-content: space-between; padding: 12px 25px; color: var(--text-muted); text-decoration: none; font-weight: 500; font-size: 0.9rem; transition: 0.2s; }
                .nav-link:hover, .nav-link.active { background-color: rgba(59, 130, 246, 0.1); color: var(--accent-blue); border-left: 3px solid var(--accent-blue); }
                .nav-link i { margin-right: 15px; font-size: 1.1rem; }
                .badge-count { background: #1e293b; color: #fff; font-size: 0.7rem; padding: 2px 8px; border-radius: 20px; }
                .nav-link.active .badge-count { background: var(--accent-blue); }

                /* Header */
                .header-top { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 30px; }
                .page-title { font-size: 1.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
                .page-subtitle { color: var(--accent-green); font-size: 0.85rem; font-weight: 600; margin-top: 5px; }
                .btn-download { background-color: #10b981; color: #fff; border: none; font-weight: 600; font-size: 0.85rem; padding: 10px 20px; border-radius: 6px; }
                .btn-download:hover { background-color: #059669; color: #fff; }
                .search-input { background-color: var(--bg-card); border: 1px solid var(--border-color); color: #fff; padding: 8px 15px; border-radius: 6px; width: 250px; font-size: 0.85rem; outline: none; }

                /* Stat Cards */
                .stat-card { background-color: var(--bg-card); border-radius: 8px; padding: 25px 20px; text-align: center; border: 1px solid var(--border-color); height: 100%; }
                .stat-title { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 10px; }
                .stat-value { font-size: 2.2rem; font-weight: 800; margin: 0; }
                .val-blue { color: var(--accent-blue); }
                .val-orange { color: var(--accent-orange); }
                .val-green { color: var(--accent-green); }

                /* Table */
                .table-container { background-color: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); padding: 0; margin-top: 30px; }
                .table { margin-bottom: 0; color: var(--text-main); }
                .table thead th { border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 15px; background-color: rgba(0,0,0,0.1); }
                .table tbody td { border-bottom: 1px solid var(--border-color); padding: 15px; vertical-align: middle; }
                .table-row:hover { background-color: rgba(255,255,255,0.02); }
                
                .patient-name-link { color: #38bdf8; font-weight: 700; text-decoration: none; font-size: 0.95rem; }
                .patient-name-link:hover { text-decoration: underline; color: #7dd3fc; }
                .contact-info { color: #64748b; font-size: 0.8rem; }
                .followup-date { color: #fbbf24; font-weight: 700; font-size: 0.85rem; }
                .report-link { color: #0ea5e9; text-decoration: none; font-size: 0.85rem; font-weight: 600; }
                .report-link:hover { text-decoration: underline; }

                /* Badges */
                .status-badge { padding: 4px 10px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; background: transparent; border: 1px solid; }
                .badge-approved { color: #10b981; border-color: #10b981; }
                .badge-pending { color: #f59e0b; border-color: #f59e0b; }
                .badge-rejected { color: #ef4444; border-color: #ef4444; }

                /* Buttons */
                .btn-action { padding: 6px 12px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-decoration: none; color: #fff; display: inline-flex; align-items: center; }
                .btn-crm { background-color: var(--accent-blue); }
                .btn-crm:hover { background-color: #2563eb; color: #fff; }
                .btn-del { background-color: #ef4444; padding: 6px 10px; }
                .btn-del:hover { background-color: #dc2626; color: #fff; }

                /* Dark Modal */
                .modal-content.dark-theme { background-color: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); }
                .modal-header.dark-theme { border-bottom: 1px solid var(--border-color); }
                .modal-footer.dark-theme { border-top: 1px solid var(--border-color); }
                .btn-close-white { filter: invert(1) grayscale(100%) brightness(200%); }
                .form-control-dark { background-color: var(--bg-card); border: 1px solid var(--border-color); color: #fff; }
                .form-control-dark:focus { background-color: var(--bg-card); color: #fff; border-color: var(--accent-blue); box-shadow: none; }
                .crm-label { font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; margin-bottom: 5px; }
                .note-card-dark { background-color: var(--bg-card); border: 1px solid var(--border-color); padding: 15px; border-radius: 6px; margin-bottom: 10px; }
            </style>
        </head>
        <body>
            <div class="app-container">
                <div class="sidebar">
                    <div class="brand">
                        <div class="brand-icon"><i class="bi bi-heart-pulse-fill"></i></div>
                        <h4>Surgical Route</h4>
                        <p>Admin Dashboard</p>
                    </div>
                    
                    <div class="nav-section">
                        <div class="nav-title">Management</div>
                        <a href="/admin" class="nav-link ${filter === '' ? 'active' : ''}"><div class="d-flex align-items-center"><i class="bi bi-grid-1x2-fill"></i> Dashboard</div> <span class="badge-count">${total}</span></a>
                    </div>
                    
                    <div class="nav-section">
                        <div class="nav-title">Quick Filters</div>
                        <a href="/admin?filter=pending" class="nav-link ${filter === 'pending' ? 'active' : ''}"><div class="d-flex align-items-center"><i class="bi bi-hourglass-split"></i> Pending</div> <span class="badge-count" style="background:#f59e0b;">${pending}</span></a>
                        <a href="/admin?filter=approved" class="nav-link ${filter === 'approved' ? 'active' : ''}"><div class="d-flex align-items-center"><i class="bi bi-check-circle-fill"></i> Approved</div> <span class="badge-count" style="background:#10b981;">${approved}</span></a>
                        <a href="/admin" class="nav-link"><div class="d-flex align-items-center"><i class="bi bi-list-task"></i> All Scheduled</div> <span class="badge-count">${scheduledTotal}</span></a>
                    </div>

                    <div class="nav-section mt-auto">
                        <div class="nav-title">System</div>
                        <a href="/logout" class="nav-link text-danger"><div class="d-flex align-items-center"><i class="bi bi-power"></i> Logout</div></a>
                    </div>
                </div>

                <div class="main-content">
                    <div class="header-top">
                        <div>
                            <h1 class="page-title">LEAD MANAGEMENT</h1>
                            <p class="page-subtitle">Surgical Route Patient Database</p>
                        </div>
                        <div class="d-flex gap-3 align-items-center">
                            <a href="/export" class="btn btn-download"><i class="bi bi-file-earmark-excel-fill me-2"></i> Download Excel Sheet</a>
                            <form method="GET" class="m-0">
                                <input type="text" name="search" class="search-input" value="${search}" placeholder="Search patients..." onchange="this.form.submit()">
                            </form>
                        </div>
                    </div>

                    <div class="row g-4 mb-4">
                        <div class="col-md-3">
                            <div class="stat-card">
                                <div class="stat-title">Total Leads</div>
                                <h3 class="stat-value val-blue">${total}</h3>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="stat-card">
                                <div class="stat-title">Pending</div>
                                <h3 class="stat-value val-orange">${pending}</h3>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="stat-card">
                                <div class="stat-title">Scheduled Total</div>
                                <h3 class="stat-value val-blue">${scheduledTotal}</h3>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="stat-card">
                                <div class="stat-title" style="color: var(--accent-green);"><i class="bi bi-telephone-fill me-1"></i> Today's Calls</div>
                                <h3 class="stat-value val-green">0</h3>
                            </div>
                        </div>
                    </div>

                    <div class="table-container">
                        <table class="table table-borderless">
                            <thead>
                                <tr>
                                    <th class="ps-4">PATIENT PROFILE</th>
                                    <th>SUBMITTED</th>
                                    <th>NEXT FOLLOW-UP</th>
                                    <th>REPORT</th>
                                    <th>STATUS / STAGE</th>
                                    <th>ACTIONS</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows || '<tr><td colspan="6" class="text-center py-5 text-muted">No leads found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="d-flex justify-content-between align-items-center mt-4 px-2">
                        <span class="text-muted" style="font-size: 0.85rem;">Page ${page}</span>
                        <div class="btn-group">
                            <a href="/admin?page=${page - 1}${filter ? '&filter='+filter : ''}" class="btn btn-sm btn-outline-secondary text-white ${page <= 1 ? 'disabled' : ''}">Prev</a>
                            <a href="/admin?page=${page + 1}${filter ? '&filter='+filter : ''}" class="btn btn-sm btn-outline-secondary text-white">Next</a>
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal fade" id="crmModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content dark-theme">
                        <div class="modal-header dark-theme">
                            <h5 class="modal-title fw-bold" id="m_name2">Patient CRM</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row g-4">
                                <div class="col-md-6 border-end border-secondary">
                                    <div class="mb-3">
                                        <div class="crm-label">Contact Details</div>
                                        <div class="text-white" id="m_phone"></div>
                                        <div class="text-secondary small" id="m_email"></div>
                                    </div>
                                    <div class="mb-3">
                                        <div class="crm-label">Concern</div>
                                        <div class="text-white small" id="m_concern"></div>
                                    </div>
                                    <hr class="border-secondary">
                                    <form id="crmForm" method="POST">
                                        <div class="mb-3">
                                            <label class="crm-label">Stage</label>
                                            <select name="leadStage" id="m_stage" class="form-select form-control-dark form-select-sm">
                                                <option>New Lead</option>
                                                <option>Follow-up Pending</option>
                                                <option>Contacted - No Answer</option>
                                                <option>Reports Pending</option>
                                                <option>Doctor Review Pending</option>
                                                <option>Converted / Closed</option>
                                            </select>
                                        </div>
                                        <div class="row g-2 mb-3">
                                            <div class="col-6">
                                                <label class="crm-label">Follow-up Date</label>
                                                <input type="date" name="followUpDate" id="m_fDate" class="form-control form-control-dark form-control-sm">
                                            </div>
                                            <div class="col-6">
                                                <label class="crm-label">Time</label>
                                                <input type="time" name="followUpTime" id="m_fTime" class="form-control form-control-dark form-control-sm">
                                            </div>
                                        </div>
                                        <button type="submit" class="btn btn-primary btn-sm w-100 fw-bold">Update CRM</button>
                                        
                                        <div class="d-flex gap-2 mt-2">
    <a href="#" id="m_approveBtn" class="btn btn-success btn-sm w-100 fw-bold">Approve</a>
    <a href="#" id="m_rejectBtn" class="btn btn-danger btn-sm w-100 fw-bold">Reject</a>
    <a href="#" id="m_waBtn" target="_blank" class="btn btn-success btn-sm w-100 fw-bold" style="background:#25D366; border:none;"><i class="bi bi-whatsapp"></i> WhatsApp</a>
</div>
                                    </form>
                                </div>
                                
                                <div class="col-md-6">
                                    <div class="crm-label">Add Note</div>
                                    <form id="noteForm" method="POST" class="mb-4">
                                        <textarea name="noteText" class="form-control form-control-dark mb-2" rows="3" placeholder="Type interaction notes..." required></textarea>
                                        <button type="submit" class="btn btn-secondary btn-sm fw-bold">Save Note</button>
                                    </form>
                                    
                                    <div class="crm-label">Note History</div>
                                    <div id="notesContainer" style="max-height: 250px; overflow-y: auto;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script>
                function openCRMModal(id, name, phone, email, status, date, time, concern, leadStage, fDate, fTime, notesData, waLink) {
                    document.getElementById('m_name2').innerText = name + " - CRM";
                    document.getElementById('m_phone').innerText = phone;
                    document.getElementById('m_email').innerText = email !== 'undefined' ? email : 'No Email';
                    document.getElementById('m_concern').innerText = concern;
                    
                    document.getElementById('m_fDate').value = fDate;
                    document.getElementById('m_fTime').value = fTime;
                    document.getElementById('m_stage').value = leadStage;
                    document.getElementById('m_waBtn').href = waLink;
                    
                    document.getElementById('crmForm').action = '/admin/crm/' + id;
                    document.getElementById('noteForm').action = '/admin/note/' + id;
                    document.getElementById('m_approveBtn').href = '/approve/' + id;
                    document.getElementById('m_rejectBtn').href = '/reject/' + id;

                    const notesContainer = document.getElementById('notesContainer');
                    notesContainer.innerHTML = '';
                    const notes = JSON.parse(decodeURIComponent(notesData));
                    
                    if(notes.length === 0) {
                        notesContainer.innerHTML = '<div class="text-muted small">No notes added.</div>';
                    } else {
                        notes.slice().reverse().forEach(n => {
                            const d = new Date(n.createdAt);
                            const displayDate = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                            notesContainer.innerHTML += \`
                                <div class="note-card-dark">
                                    <div class="d-flex justify-content-between mb-1">
                                        <span class="text-white" style="font-size:0.75rem;"><i class="bi bi-person-circle me-1"></i>Admin</span>
                                        <span class="text-secondary" style="font-size:0.7rem;">\${displayDate}</span>
                                    </div>
                                    <div class="text-light" style="font-size:0.85rem;">\${n.text}</div>
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
        // Email logic can stay here
        res.redirect('/admin');
    } catch (e) { res.redirect('/admin'); }
});

app.get('/reject/:id', isAdmin, async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(req.params.id, { status: "Rejected" }, { returnDocument: 'after' });
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
        { header: 'Stage', key: 'leadStage' }, { header: 'Report File', key: 'report' } 
    ];
    contacts.forEach(c => worksheet.addRow(c));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=appointments.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

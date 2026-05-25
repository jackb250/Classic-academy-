const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./config/db');

// Controllers
const auth = require('./controllers/authController');
const departments = require('./controllers/departmentController');
const employees = require('./controllers/employeeController');
const attendance = require('./controllers/attendanceController');
const salaries = require('./controllers/salaryController');

// Middlewares
const { authenticateToken, requireAdmin, requireAdminOrManager } = require('./middleware/authMiddleware');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory on startup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Config Multer for Profile Photo Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'photo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only images (jpeg, jpg, png, webp) are allowed."));
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

// Configure Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Uploads folder
app.use('/uploads', express.static(uploadsDir));

// --- 1. Authentication Routes ---
app.post('/api/auth/register', auth.register);
app.post('/api/auth/login', auth.login);
app.get('/api/auth/profile', authenticateToken, auth.getProfile);

// --- 2. Department Routes (Admin & Manager) ---
app.get('/api/departments', authenticateToken, departments.getDepartments);
app.get('/api/departments/:id', authenticateToken, departments.getDepartmentById);
app.post('/api/departments', authenticateToken, requireAdminOrManager, departments.addDepartment);
app.put('/api/departments/:id', authenticateToken, requireAdminOrManager, departments.updateDepartment);
app.delete('/api/departments/:id', authenticateToken, requireAdmin, departments.deleteDepartment);

// --- 3. Employee Routes (Admin & Manager) ---
app.get('/api/employees', authenticateToken, employees.getEmployees);
app.get('/api/employees/:id', authenticateToken, employees.getEmployeeById);
app.post('/api/employees', authenticateToken, requireAdminOrManager, upload.single('photo'), employees.registerEmployee);
app.put('/api/employees/:id', authenticateToken, requireAdminOrManager, upload.single('photo'), employees.editEmployee);
app.delete('/api/employees/:id', authenticateToken, requireAdmin, employees.deleteEmployee);

// --- 4. Attendance Routes (Admin & Manager) ---
app.get('/api/attendance', authenticateToken, attendance.getAttendanceByDate);
app.post('/api/attendance', authenticateToken, requireAdminOrManager, attendance.recordAttendance);
app.get('/api/attendance/report', authenticateToken, attendance.getAttendanceReport);

// --- 5. Salary/Payroll Routes (Admin Only for destructive, Admin/Manager for viewing) ---
app.get('/api/salaries', authenticateToken, salaries.getSalaryPayments);
app.post('/api/salaries', authenticateToken, requireAdmin, salaries.recordSalaryPayment);
app.get('/api/salaries/payslip/:id', authenticateToken, salaries.getPayslip);
app.delete('/api/salaries/:id', authenticateToken, requireAdmin, salaries.deleteSalaryRecord);

// --- 6. Analytics/Metrics Dashboard Route ---
app.get('/api/dashboard/metrics', authenticateToken, async (req, res) => {
  try {
    const empCount = await db.query("SELECT COUNT(*) as count FROM employees WHERE status = 'Active'");
    const deptCount = await db.query("SELECT COUNT(*) as count FROM departments");
    
    // Calculate total net payroll distributed
    const payrollSum = await db.query("SELECT SUM(net_salary) as sum FROM salaries");
    
    // Calculate daily attendance ratio
    const todayStr = new Date().toISOString().split('T')[0];
    const presentToday = await db.query(
      "SELECT COUNT(*) as count FROM attendance WHERE date = ? AND status = 'Present'",
      [todayStr]
    );

    res.status(200).json({
      totalEmployees: empCount[0] ? empCount[0].count : 0,
      totalDepartments: deptCount[0] ? deptCount[0].count : 0,
      totalPayroll: payrollSum[0] ? payrollSum[0].sum || 0.00 : 0.00,
      presentToday: presentToday[0] ? presentToday[0].count : 0,
      dbEngine: db.getDbType()
    });
  } catch (err) {
    console.error("Dashboard Metrics Error:", err.message);
    res.status(500).json({ error: "Failed to load dashboard metrics." });
  }
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Global Error Handler Catch-all:", err.message);
  res.status(err.status || 500).json({
    error: err.message || "An unexpected error occurred on the server."
  });
});

// Initialize database connection & start listening
db.initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Classic Academy EIMS Server running on http://localhost:${PORT}`);
    console.log(`📁 Database in use: [${db.getDbType()}]`);
  });
}).catch(err => {
  console.error("❌ Critical server bootstrap failure:", err.message);
  process.exit(1);
});

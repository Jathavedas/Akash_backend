require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./config/db');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/authRoutes');
const siteRoutes = require('./routes/siteRoutes');
const workerRoutes = require('./routes/workerRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const userRoutes = require('./routes/userRoutes');

// Initialize background jobs
require('./cron/payrollCron');

const app = express();

// Connect to Database
connectDB();

// Middleware
const allowedOrigins = ['http://localhost:5173', 'https://akash-omega-seven.vercel.app','https://coolnestengineering.in'];
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
// UptimeRobot Health Check Route
app.get('/api/health', (req, res) => res.status(200).send('OK'));

app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/users', userRoutes);

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../coolnest-hvac/dist')));

  app.get(/.*/, (req, res) => {
    res.sendFile(path.resolve(__dirname, '../coolnest-hvac/dist', 'index.html'));
  });
} else {
  // Health check route
  app.get('/', (req, res) => {
    res.send('API is running...');
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

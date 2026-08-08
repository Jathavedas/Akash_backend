const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Worker = require('../models/Worker');
const { protect } = require('../middlewares/authMiddleware');
const { supervisorOrAdmin, adminOnly } = require('../middlewares/roleMiddleware');

// @desc    Mark bulk attendance for a specific date and site
// @route   POST /api/attendance/bulk
// @access  Private (Supervisor/Admin)
router.post('/bulk', protect, supervisorOrAdmin, async (req, res) => {
  const { date, siteId, attendances } = req.body;
  // attendances = [{ workerId, status }, ...]

  try {
    // Validate site access
    if (req.user.role === 'Supervisor' && req.user.assignedSite.toString() !== siteId) {
      return res.status(403).json({ message: 'Not authorized for this site' });
    }

    const attendanceRecords = [];
    const errors = [];

    if (req.user.role === 'Supervisor') {
      const todayStr = new Date().toISOString().substring(0, 10);
      if (date !== todayStr) {
        return res.status(403).json({ message: 'Supervisors can only mark attendance for today' });
      }

      // Check for 9:30 AM IST deadline
      const now = new Date();
      const istTime = new Date(now.getTime() + (330 * 60000));
      const hours = istTime.getUTCHours();
      const minutes = istTime.getUTCMinutes();
      if (hours > 9 || (hours === 9 && minutes > 30)) {
        return res.status(403).json({ message: 'Supervisors can only mark attendance till 9:30 AM' });
      }
    }

    // Parse date ensuring it's standard UTC midnight for strict matching
    const targetDate = new Date(date);
    targetDate.setUTCHours(0, 0, 0, 0);

    for (let record of attendances) {
      try {
        // Upsert approach to allow toggling/editing
        const existing = await Attendance.findOne({
          workerId: record.workerId,
          date: targetDate
        });

        if (existing) {
          existing.status = record.status;
          existing.overtimeHours = record.overtimeHours || 0;
          existing.markedBy = req.user._id;
          await existing.save();
          attendanceRecords.push(existing);
        } else {
          const newAtt = await Attendance.create({
            workerId: record.workerId,
            siteId: siteId,
            date: targetDate,
            status: record.status,
            overtimeHours: record.overtimeHours || 0,
            markedBy: req.user._id
          });
          attendanceRecords.push(newAtt);
        }
      } catch (err) {
        errors.push({ workerId: record.workerId, error: err.message });
      }
    }

    res.status(201).json({ message: 'Attendance processed', attendanceRecords, errors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get attendance records by date and site
// @route   GET /api/attendance
// @access  Private
router.get('/', protect, supervisorOrAdmin, async (req, res) => {
  const { date, siteId } = req.query;
  
  if (!date || !siteId) {
    return res.status(400).json({ message: 'Please provide date and siteId' });
  }

  try {
    if (req.user.role === 'Supervisor' && req.user.assignedSite.toString() !== siteId) {
      return res.status(403).json({ message: 'Not authorized for this site' });
    }

    const targetDate = new Date(date);
    targetDate.setUTCHours(0,0,0,0);

    const attendances = await Attendance.find({ 
      siteId, 
      date: targetDate 
    }).populate('workerId', 'firstName lastName employeeId designation');

    res.json(attendances);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get attendance records for a specific worker
// @route   GET /api/attendance/worker/:workerId
// @access  Private
router.get('/worker/:workerId', protect, supervisorOrAdmin, async (req, res) => {
  try {
    const { workerId } = req.params;
    const attendances = await Attendance.find({ workerId }).sort({ date: 1 });
    res.json(attendances);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get monthly overtime summary for a site
// @route   GET /api/attendance/monthly-summary
// @access  Private
router.get('/monthly-summary', protect, supervisorOrAdmin, async (req, res) => {
  const { siteId, year, month } = req.query; // month 1-12
  try {
    if (req.user.role === 'Supervisor' && req.user.assignedSite.toString() !== siteId) {
      return res.status(403).json({ message: 'Not authorized for this site' });
    }
    
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const summary = await Attendance.aggregate([
      { 
        $match: { 
          siteId: new mongoose.Types.ObjectId(siteId),
          date: { $gte: startDate, $lte: endDate }
        } 
      },
      {
        $group: {
          _id: '$workerId',
          totalOvertime: { $sum: '$overtimeHours' }
        }
      }
    ]);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get today's attendance summary grouped by site
// @route   GET /api/attendance/today-summary
// @access  Private/Admin
router.get('/today-summary', protect, adminOnly, async (req, res) => {
  try {
    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    // To match how frontend/DB saves it (UTC midnight):
    const todayStr = new Date().toISOString().substring(0, 10);
    const queryDate = new Date(todayStr);
    queryDate.setUTCHours(0, 0, 0, 0);

    const workers = await Worker.find({ status: 'Active' }).populate('assignedSite', 'name');
    const attendances = await Attendance.find({ date: queryDate });

    const siteMap = {};

    workers.forEach(w => {
      const site = w.assignedSite;
      if (!site) return;
      const siteId = site._id.toString();
      if (!siteMap[siteId]) {
        siteMap[siteId] = {
          siteId,
          siteName: site.name,
          total: 0,
          present: 0,
          absent: 0,
          pending: 0
        };
      }
      siteMap[siteId].total += 1;
    });

    attendances.forEach(a => {
      const siteId = a.siteId.toString();
      if (siteMap[siteId]) {
        if (a.status === 'Present') siteMap[siteId].present += 1;
        if (a.status === 'Absent') siteMap[siteId].absent += 1;
      }
    });

    // Calculate pending
    Object.values(siteMap).forEach(site => {
      site.pending = site.total - (site.present + site.absent);
    });

    res.json(Object.values(siteMap));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

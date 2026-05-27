const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Worker = require('../models/Worker');
const { protect } = require('../middlewares/authMiddleware');
const { supervisorOrAdmin } = require('../middlewares/roleMiddleware');

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

module.exports = router;

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Worker = require('../models/Worker');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly, staffOnly, managerOrAdmin } = require('../middlewares/roleMiddleware');
const { normalizePhoneNumber } = require('../utils/phoneHelper');
const { logAudit } = require('../utils/auditLogger');

// @desc    Self-Service Profile Spelling Correction
// @route   PUT /api/attendance/self-edit-name
// @access  Public (Verified by registered phone number)
router.put('/self-edit-name', async (req, res) => {
  try {
    const { phoneNumber, firstName, lastName } = req.body;

    if (!phoneNumber || !firstName || !lastName) {
      return res.status(400).json({ message: 'Phone number, First Name, and Last Name are required' });
    }

    const cleanPhone = normalizePhoneNumber(phoneNumber);
    const worker = await Worker.findOne({ phoneNumber: cleanPhone });

    if (!worker) {
      return res.status(404).json({ message: 'Technician profile not found for this mobile number' });
    }

    // Name validation: Alphabetical characters, spaces, and hyphens only (min 2, max 40 chars)
    const nameRegex = /^[A-Za-z\s\-]{2,40}$/;
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!nameRegex.test(trimmedFirst) || !nameRegex.test(trimmedLast)) {
      return res.status(400).json({ 
        message: 'Invalid name format. Names must contain only letters, spaces, or hyphens (2-40 characters).' 
      });
    }

    const previousState = {
      firstName: worker.firstName,
      lastName: worker.lastName
    };

    worker.firstName = trimmedFirst;
    worker.lastName = trimmedLast;
    await worker.save();

    await logAudit({
      performedBy: {
        name: `${trimmedFirst} ${trimmedLast}`,
        role: 'Field Worker Self-Service'
      },
      actionType: 'NAME_CORRECTION',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${trimmedFirst} ${trimmedLast} (${worker.employeeId})`
      },
      previousState,
      newState: {
        firstName: trimmedFirst,
        lastName: trimmedLast
      },
      details: `Technician spelling correction from "${previousState.firstName} ${previousState.lastName}" to "${trimmedFirst} ${trimmedLast}"`
    });

    res.json({
      message: 'Name spelling updated successfully',
      worker: {
        _id: worker._id,
        firstName: worker.firstName,
        lastName: worker.lastName,
        employeeId: worker.employeeId
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get worker monthly attendance calendar (Public or Self lookup)
// @route   GET /api/attendance/calendar/:identifier
// @access  Public
router.get('/calendar/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const cleanPhone = normalizePhoneNumber(identifier);
    const searchRegex = new RegExp(`^${identifier.trim()}$`, 'i');

    const worker = await Worker.findOne({
      $or: [
        { phoneNumber: cleanPhone },
        { employeeId: searchRegex }
      ]
    }).populate('assignedSite', 'name location');

    if (!worker) {
      return res.status(404).json({ message: 'No technician found with this Phone Number or Employee ID' });
    }

    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const attendances = await Attendance.find({
      workerId: worker._id,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });

    const calendar = attendances.map(a => ({
      date: a.date.toISOString().substring(0, 10),
      status: a.status,
      overtimeHours: a.overtimeHours
    }));

    const totalOvertime = attendances.reduce((sum, a) => sum + (a.overtimeHours || 0), 0);
    const presentDays = attendances.filter(a => a.status === 'Present').length;
    const absentDays = attendances.filter(a => a.status === 'Absent').length;

    res.json({
      worker: {
        _id: worker._id,
        firstName: worker.firstName,
        lastName: worker.lastName,
        name: `${worker.firstName} ${worker.lastName}`,
        employeeId: worker.employeeId,
        phoneNumber: worker.phoneNumber,
        designation: worker.designation,
        site: worker.assignedSite ? worker.assignedSite.name : null
      },
      year,
      month,
      calendar,
      summary: { presentDays, absentDays, totalOvertime }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Mark bulk attendance for a specific date and site (Supports historical date for Admin/Manager)
// @route   POST /api/attendance/bulk
// @access  Private (Supervisor, Manager, Admin)
router.post('/bulk', protect, staffOnly, async (req, res) => {
  const { date, siteId, attendances } = req.body;

  try {
    // Validate site access for Supervisors
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite || req.user.assignedSite.toString() !== siteId) {
        return res.status(403).json({ message: 'Not authorized for this site' });
      }

      const todayStr = new Date().toISOString().substring(0, 10);
      if (date !== todayStr) {
        return res.status(403).json({ message: 'Supervisors can only mark attendance for today. Historical edits require Admin or Manager authorization.' });
      }

      // Check for 9:30 AM IST deadline
      const now = new Date();
      const istTime = new Date(now.getTime() + (330 * 60000));
      const hours = istTime.getUTCHours();
      const minutes = istTime.getUTCMinutes();
      if (hours > 9 || (hours === 9 && minutes > 30)) {
        return res.status(403).json({ message: 'Attendance marking closed after 9:30 AM for supervisors' });
      }
    }

    // Parse date ensuring UTC midnight
    const targetDate = new Date(date);
    targetDate.setUTCHours(0, 0, 0, 0);

    const attendanceRecords = [];
    const errors = [];

    for (let record of attendances) {
      try {
        const existing = await Attendance.findOne({
          workerId: record.workerId,
          date: targetDate
        }).populate('workerId', 'firstName lastName employeeId');

        if (existing) {
          const prevStatus = existing.status;
          const prevOt = existing.overtimeHours || 0;
          const newStatus = record.status;
          const newOt = Number(record.overtimeHours) || 0;

          existing.status = newStatus;
          existing.overtimeHours = newOt;
          existing.markedBy = req.user._id;
          await existing.save();
          attendanceRecords.push(existing);

          // Audit logging for overrides and overtime changes
          if (prevStatus !== newStatus) {
            await logAudit({
              performedBy: req.user,
              actionType: 'ATTENDANCE_OVERRIDE',
              targetEntity: {
                entityType: 'Attendance',
                entityId: existing._id.toString(),
                name: `${existing.workerId?.firstName || 'Worker'} (${existing.workerId?.employeeId || ''})`
              },
              previousState: { status: prevStatus, date: targetDate },
              newState: { status: newStatus, date: targetDate },
              details: `Attendance status changed from ${prevStatus} to ${newStatus} on ${date} by ${req.user.name}`
            });
          }

          if (prevOt !== newOt) {
            await logAudit({
              performedBy: req.user,
              actionType: 'OVERTIME_UPDATE',
              targetEntity: {
                entityType: 'Attendance',
                entityId: existing._id.toString(),
                name: `${existing.workerId?.firstName || 'Worker'} (${existing.workerId?.employeeId || ''})`
              },
              previousState: { overtimeHours: prevOt, date: targetDate },
              newState: { overtimeHours: newOt, date: targetDate },
              details: `Overtime updated from ${prevOt}h to ${newOt}h on ${date} by ${req.user.name}`
            });
          }
        } else {
          const newAtt = await Attendance.create({
            workerId: record.workerId,
            siteId: siteId,
            date: targetDate,
            status: record.status,
            overtimeHours: Number(record.overtimeHours) || 0,
            markedBy: req.user._id
          });
          attendanceRecords.push(newAtt);
        }
      } catch (err) {
        errors.push({ workerId: record.workerId, error: err.message });
      }
    }

    res.status(201).json({ message: 'Attendance processed successfully', attendanceRecords, errors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get attendance records by date and site
// @route   GET /api/attendance
// @access  Private
router.get('/', protect, staffOnly, async (req, res) => {
  const { date, siteId } = req.query;
  
  if (!date || !siteId) {
    return res.status(400).json({ message: 'Please provide date and siteId' });
  }

  try {
    if (req.user.role === 'Supervisor' && req.user.assignedSite?.toString() !== siteId) {
      return res.status(403).json({ message: 'Not authorized for this site' });
    }

    const targetDate = new Date(date);
    targetDate.setUTCHours(0, 0, 0, 0);

    const attendances = await Attendance.find({ 
      siteId, 
      date: targetDate 
    }).populate('workerId', 'firstName lastName employeeId designation phoneNumber');

    res.json(attendances);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get attendance records for a specific worker
// @route   GET /api/attendance/worker/:workerId
// @access  Private
router.get('/worker/:workerId', protect, staffOnly, async (req, res) => {
  try {
    const { workerId } = req.params;
    const attendances = await Attendance.find({ workerId }).sort({ date: 1 });
    res.json(attendances);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get attendance summary grouped by site for any selected date (defaults to today)
// @route   GET /api/attendance/today-summary
// @access  Private (Admin & Manager)
router.get('/today-summary', protect, managerOrAdmin, async (req, res) => {
  try {
    let targetDateStr = req.query.date;
    if (!targetDateStr) {
      targetDateStr = new Date().toISOString().substring(0, 10);
    }
    const queryDate = new Date(targetDateStr);
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

    Object.values(siteMap).forEach(site => {
      site.pending = Math.max(site.total - (site.present + site.absent), 0);
    });

    res.json(Object.values(siteMap));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

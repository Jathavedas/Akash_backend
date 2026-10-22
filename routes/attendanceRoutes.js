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
      return res.status(404).json({ message: 'Worker profile not found for this mobile number' });
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
      details: `Worker spelling correction from "${previousState.firstName} ${previousState.lastName}" to "${trimmedFirst} ${trimmedLast}"`
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
      return res.status(404).json({ message: 'No worker found with this Phone Number or Employee ID' });
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
      overtimeHours: Math.round(a.overtimeHours || 0)
    }));

    const totalOvertime = Math.round(attendances.reduce((sum, a) => sum + (a.overtimeHours || 0), 0));
    const presentDays = attendances.filter(a => a.status === 'Present').length;
    const halfDays = attendances.filter(a => a.status === 'Half Day').length;
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
      summary: { presentDays, halfDays, absentDays, totalOvertime }
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
    const isSupervisor = req.user.role === 'Supervisor';
    const isManager = req.user.role === 'Manager';
    const isAdmin = req.user.role === 'Admin';

    // Parse date ensuring UTC midnight
    const targetDate = new Date(date);
    targetDate.setUTCHours(0, 0, 0, 0);

    // Validate site access for Supervisors
    if (isSupervisor) {
      if (!req.user.assignedSite || req.user.assignedSite.toString() !== siteId) {
        return res.status(403).json({ message: 'Not authorized for this site' });
      }

      const todayStr = new Date().toISOString().substring(0, 10);
      if (date !== todayStr) {
        return res.status(403).json({ message: 'Supervisors can only mark attendance for today. Historical edits require Admin or Manager authorization.' });
      }

      // Check for 9:30 AM IST deadline: Only Present has a time limit, Absent has NO time limit
      const now = new Date();
      const istTime = new Date(now.getTime() + (330 * 60000));
      const hours = istTime.getUTCHours();
      const minutes = istTime.getUTCMinutes();
      const isPastDeadline = hours > 9 || (hours === 9 && minutes >= 30);

      if (isPastDeadline) {
        // After 9:30 AM, supervisors can mark Absent, but cannot newly mark Present
        for (let record of attendances) {
          if (record.status === 'Present') {
            const existing = await Attendance.findOne({
              workerId: record.workerId,
              date: targetDate
            });
            if (!existing || existing.status !== 'Present') {
              return res.status(403).json({ 
                message: 'Marking "Present" is restricted after 9:30 AM for supervisors. You can still mark workers as "Absent".' 
              });
            }
          }
        }
      }
    }

    const attendanceRecords = [];
    const errors = [];

    for (let record of attendances) {
      try {
        // Enforce valid status: Present, Absent, Half Day
        let newStatus = record.status;
        if (!['Present', 'Absent', 'Half Day'].includes(newStatus)) {
          newStatus = 'Absent';
        }

        // Overtime rule: NO overtime for supervisors!
        // Overtime is only permitted for managers and admin. Must be integer (no decimals).
        let newOt = 0;
        if (!isSupervisor) {
          newOt = Math.max(0, parseInt(record.overtimeHours, 10) || 0);
        }

        const existing = await Attendance.findOne({
          workerId: record.workerId,
          date: targetDate
        }).populate('workerId', 'firstName lastName employeeId');

        if (existing) {
          const prevStatus = existing.status;
          const prevOt = Math.round(existing.overtimeHours || 0);

          // If supervisor, preserve existing overtime if any, do not let supervisor overwrite it
          if (isSupervisor) {
            newOt = prevOt;
          }

          existing.status = newStatus;
          existing.siteId = siteId; // Crucial: ensure siteId reflects the site marking today!
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
              previousState: { status: prevStatus, overtimeHours: prevOt, date: targetDate },
              newState: { status: newStatus, overtimeHours: newOt, date: targetDate },
              details: `Attendance status changed from ${prevStatus} to ${newStatus} on ${date} by ${req.user.name} (${req.user.role})`
            });
          }

          if (!isSupervisor && prevOt !== newOt) {
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
              details: `Overtime updated from ${prevOt}h to ${newOt}h on ${date} by ${req.user.name} (${req.user.role})`
            });
          }
        } else {
          const newAtt = await Attendance.create({
            workerId: record.workerId,
            siteId: siteId,
            date: targetDate,
            status: newStatus,
            overtimeHours: newOt,
            markedBy: req.user._id
          });
          attendanceRecords.push(newAtt);

          // If marked by Manager or Admin, record in Audit Log for full transparency
          if (isManager || isAdmin) {
            const workerObj = await Worker.findById(record.workerId).select('firstName lastName employeeId');
            await logAudit({
              performedBy: req.user,
              actionType: 'ATTENDANCE_MARK',
              targetEntity: {
                entityType: 'Attendance',
                entityId: newAtt._id.toString(),
                name: `${workerObj?.firstName || 'Worker'} ${workerObj?.lastName || ''} (${workerObj?.employeeId || ''})`
              },
              previousState: null,
              newState: { status: newStatus, overtimeHours: newOt, date: targetDate, siteId },
              details: `Attendance shift marked as ${newStatus}${newOt > 0 ? ` (OT: ${newOt}h)` : ''} for ${workerObj?.firstName || 'Worker'} on ${date} by ${req.user.name} (${req.user.role})`
            });
          }
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
    }).populate('workerId', 'firstName lastName employeeId designation phoneNumber assignedSite pendingSite transferStatus');

    res.json(attendances);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get monthly overtime summary by site
// @route   GET /api/attendance/monthly-summary
// @access  Private
router.get('/monthly-summary', protect, staffOnly, async (req, res) => {
  try {
    const { siteId, year, month } = req.query;
    if (!siteId || !year || !month) {
      return res.status(400).json({ message: 'siteId, year, and month are required' });
    }
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    const records = await Attendance.aggregate([
      {
        $match: {
          siteId: new mongoose.Types.ObjectId(siteId),
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$workerId',
          totalOvertime: { $sum: '$overtimeHours' },
          presentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] }
          },
          halfDays: {
            $sum: { $cond: [{ $eq: ['$status', 'Half Day'] }, 1, 0] }
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json(records);
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

    const workers = await Worker.find({ status: 'Active' })
      .populate('assignedSite', 'name')
      .populate('pendingSite', 'name');
    const attendances = await Attendance.find({ date: queryDate });

    const siteMap = {};

    workers.forEach(w => {
      // If worker has a pending transfer, they are active at pendingSite
      const site = (w.transferStatus === 'Pending' && w.pendingSite) ? w.pendingSite : w.assignedSite;
      if (!site) return;
      const siteId = site._id.toString();
      if (!siteMap[siteId]) {
        siteMap[siteId] = {
          siteId,
          siteName: site.name,
          total: 0,
          present: 0,
          halfDay: 0,
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
        if (a.status === 'Half Day') siteMap[siteId].halfDay += 1;
        if (a.status === 'Absent') siteMap[siteId].absent += 1;
      }
    });

    Object.values(siteMap).forEach(site => {
      site.pending = Math.max(site.total - (site.present + site.halfDay + site.absent), 0);
    });

    res.json(Object.values(siteMap));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

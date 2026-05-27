const express = require('express');
const router = express.Router();
const Payroll = require('../models/Payroll');
const Worker = require('../models/Worker');
const Attendance = require('../models/Attendance');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly, supervisorOrAdmin } = require('../middlewares/roleMiddleware');

// @desc    Generate/Calculate payroll for a month
// @route   POST /api/payroll/generate
// @access  Private/Admin
router.post('/generate', protect, supervisorOrAdmin, async (req, res) => {
  const { month, year, workerIds } = req.body;
  // workerIds can be 'all' or an array of specific IDs

  if (!month || !year) {
    return res.status(400).json({ message: 'Month and year are required' });
  }

  try {
    let query = { status: 'Active' };
    if (Array.isArray(workerIds)) {
      query._id = { $in: workerIds };
    }
    
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.status(403).json({ message: 'No site assigned to this supervisor' });
      }
      query.assignedSite = req.user.assignedSite;
    }

    const workers = await Worker.find(query);
    const results = [];
    const errors = [];

    // Date range for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1, 0, 0, 0, 0);

    for (let worker of workers) {
      try {
        // Fetch attendances for that month
        const attendances = await Attendance.find({
          workerId: worker._id,
          date: { $gte: startDate, $lt: endDate }
        });

        let present = 0;
        let absent = 0;
        let totalOvertimeHours = 0;

        attendances.forEach(a => {
          if (a.status === 'Present') {
            present++;
            if (a.overtimeHours) totalOvertimeHours += a.overtimeHours;
          } else if (a.status === 'Absent') {
            absent++;
          }
        });

        let calculatedOvertimePay = totalOvertimeHours * (worker.baseSalary / 8);
        let calculatedNet = (worker.baseSalary * present) + calculatedOvertimePay;

        // Upsert Payroll
        const payroll = await Payroll.findOneAndUpdate(
          { workerId: worker._id, month, year },
          {
            presentDays: present,
            absentDays: absent,
            baseSalary: worker.baseSalary,
            overtime: calculatedOvertimePay,
            netSalary: Math.max(0, calculatedNet),
            // bonus, deductions can be updated later via PUT
          },
          { returnDocument: 'after', upsert: true }
        );

        results.push(payroll);
      } catch (err) {
        errors.push({ workerId: worker._id, error: err.message });
      }
    }

    res.status(200).json({ message: 'Payroll generation complete', results, errors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get payroll history
// @route   GET /api/payroll
// @access  Private/Admin or Supervisor
router.get('/', protect, supervisorOrAdmin, async (req, res) => {
  const { month, year, workerId } = req.query;
  const query = {};
  if (month) query.month = parseInt(month, 10);
  if (year) query.year = parseInt(year, 10);
  if (workerId) query.workerId = workerId;

  try {
    const payrolls = await Payroll.find(query).populate('workerId', 'firstName lastName employeeId designation salaryType phoneNumber assignedSite').populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });
    let validPayrolls = payrolls.filter(pr => pr.workerId !== null);
    
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.json([]);
      }
      validPayrolls = validPayrolls.filter(pr => {
        const siteId = pr.workerId.assignedSite?._id || pr.workerId.assignedSite;
        return siteId?.toString() === req.user.assignedSite.toString();
      });
    }
    
    res.json(validPayrolls);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== PDF GENERATION =====
const PDFDocument = require('pdfkit');
const { drawPayslip } = require('../utils/pdfHelper');



const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// @desc    Download single payslip PDF
// @route   GET /api/payroll/pdf/:id
// @access  Private/Admin or Supervisor
router.get('/pdf/:id', protect, supervisorOrAdmin, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    if (!payroll || !payroll.workerId) return res.status(404).json({ message: 'Payroll record or associated worker not found' });

    if (req.user.role === 'Supervisor') {
      const siteId = payroll.workerId.assignedSite?._id || payroll.workerId.assignedSite;
      if (!req.user.assignedSite || siteId?.toString() !== req.user.assignedSite.toString()) {
        return res.status(403).json({ message: 'Not authorized to view this payslip' });
      }
    }

    const monthName = MONTH_NAMES[payroll.month - 1];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Payslip_${payroll.workerId.employeeId}_${monthName}_${payroll.year}.pdf`);

    doc.pipe(res);
    drawPayslip(doc, payroll, monthName, payroll.year);
    doc.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Download ALL payslips for a month as a single PDF
// @route   GET /api/payroll/pdf-all?month=X&year=Y
// @access  Private/Admin or Supervisor
router.get('/pdf-all', protect, supervisorOrAdmin, async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ message: 'Month and year required' });

  try {
    const payrolls = await Payroll.find({ month: parseInt(month), year: parseInt(year) })
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    let validPayrolls = payrolls.filter(pr => pr.workerId !== null);

    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.status(403).json({ message: 'No site assigned to this supervisor' });
      }
      validPayrolls = validPayrolls.filter(pr => {
        const siteId = pr.workerId.assignedSite?._id || pr.workerId.assignedSite;
        return siteId?.toString() === req.user.assignedSite.toString();
      });
    }

    if (validPayrolls.length === 0) return res.status(404).json({ message: 'No valid payroll records found for this month' });

    const monthName = MONTH_NAMES[parseInt(month) - 1];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=All_Payslips_${monthName}_${year}.pdf`);

    doc.pipe(res);

    validPayrolls.forEach((pr, index) => {
      if (index > 0) doc.addPage();
      drawPayslip(doc, pr, monthName, year);
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const { generatePayslipBuffer } = require('../utils/pdfHelper');
const { sendPayslipEmail } = require('../utils/emailService');

// @desc    Manually trigger email sending for a specific month
// @route   POST /api/payroll/send-emails
// @access  Private/Admin
router.post('/send-emails', protect, adminOnly, async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ message: 'Month and year required' });

  try {
    const payrolls = await Payroll.find({ month: parseInt(month), year: parseInt(year) })
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    const eligibleWorkers = payrolls.filter(pr => pr.workerId && pr.workerId.email);
    
    if (eligibleWorkers.length === 0) {
      return res.status(400).json({ message: 'No eligible workers with email addresses found.' });
    }

    // Respond immediately to prevent gateway timeout
    res.json({ message: `Started sending emails to ${eligibleWorkers.length} workers. You can continue using the dashboard.` });

    // Process in background
    setTimeout(async () => {
      const monthName = MONTH_NAMES[parseInt(month) - 1];
      for (let pr of eligibleWorkers) {
        try {
          const pdfBuffer = await generatePayslipBuffer(pr, monthName, year);
          await sendPayslipEmail(pr.workerId, pdfBuffer, monthName, year);
        } catch (err) {
          console.error(`Failed to send email to ${pr.workerId.employeeId}: ${err.message}`);
        }
      }
    }, 0);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Update payroll status
// @route   PUT /api/payroll/:id/status
// @access  Private/Admin
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!['Pending', 'Approved', 'Paid'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) {
      return res.status(404).json({ message: 'Payroll not found' });
    }

    payroll.status = status;
    await payroll.save();

    res.json({ message: 'Payroll status updated successfully', payroll });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Payroll = require('../models/Payroll');
const Worker = require('../models/Worker');
const Attendance = require('../models/Attendance');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly } = require('../middlewares/roleMiddleware');
const { logAudit } = require('../utils/auditLogger');

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// @desc    Generate/Calculate payroll for a month
// @route   POST /api/payroll/generate
// @access  Private/Admin
router.post('/generate', protect, adminOnly, async (req, res) => {
  const { month, year, workerIds, siteId } = req.body;

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
    } else if (req.user.role === 'Admin' && siteId) {
      query.assignedSite = siteId;
    }

    const workers = await Worker.find(query);
    const results = [];
    const errors = [];

    // Date range for the month
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

    for (let worker of workers) {
      try {
        // Fetch attendances for that month
        const attendances = await Attendance.find({
          workerId: worker._id,
          date: { $gte: startDate, $lt: endDate }
        });

        let present = 0;
        let halfDays = 0;
        let absent = 0;
        let totalOvertimeHours = 0;

        attendances.forEach(a => {
          if (a.status === 'Present') {
            present++;
            if (a.overtimeHours) totalOvertimeHours += Math.round(a.overtimeHours);
          } else if (a.status === 'Half Day') {
            halfDays++;
            if (a.overtimeHours) totalOvertimeHours += Math.round(a.overtimeHours);
          } else if (a.status === 'Absent') {
            absent++;
          }
        });

        // Preserve existing deductions & bonus if previously set
        const existingPayroll = await Payroll.findOne({ workerId: worker._id, month, year });
        const existingAdvance = existingPayroll?.advanceDeduction || 0;
        const existingBonus = existingPayroll?.bonus || 0;
        const existingOther = existingPayroll?.otherDeduction || 0;

        const hourlyRate = (worker.baseSalary || 700) / 8;
        const calculatedOvertimePay = Math.round(totalOvertimeHours * hourlyRate);
        const halfDayPay = Math.round(halfDays * ((worker.baseSalary || 700) * 0.5));
        const fullDayPay = Math.round(present * (worker.baseSalary || 700));
        const grossEarnings = fullDayPay + halfDayPay + calculatedOvertimePay + existingBonus;
        const calculatedNet = Math.max(0, grossEarnings - existingAdvance - existingOther);

        // Upsert Payroll
        const payroll = await Payroll.findOneAndUpdate(
          { workerId: worker._id, month, year },
          {
            presentDays: present,
            halfDays: halfDays,
            absentDays: absent,
            baseSalary: worker.baseSalary || 700,
            overtime: calculatedOvertimePay,
            advanceDeduction: existingAdvance,
            bonus: existingBonus,
            otherDeduction: existingOther,
            netSalary: calculatedNet,
          },
          { returnDocument: 'after', upsert: true }
        );

        results.push(payroll);
      } catch (err) {
        errors.push({ workerId: worker._id, error: err.message });
      }
    }

    await logAudit({
      performedBy: req.user,
      actionType: 'PAYROLL_GENERATE',
      targetEntity: {
        entityType: 'Payroll',
        entityId: `${month}-${year}`,
        name: `Payroll for ${MONTH_NAMES[month - 1]} ${year}`
      },
      previousState: null,
      newState: { month, year, processedCount: results.length, siteId },
      details: `Monthly payroll generated for ${results.length} workers (${MONTH_NAMES[month - 1]} ${year}) by ${req.user.name}`
    });

    res.status(200).json({ message: 'Payroll generation complete', results, errors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get payroll history
// @route   GET /api/payroll
// @access  Private/Admin or Supervisor
router.get('/', protect, adminOnly, async (req, res) => {
  const { month, year, workerId, siteId: querySiteId } = req.query;
  const query = {};
  if (month) query.month = parseInt(month, 10);
  if (year) query.year = parseInt(year, 10);
  if (workerId) query.workerId = workerId;

  try {
    const payrolls = await Payroll.find(query)
      .populate('workerId', 'firstName lastName employeeId designation salaryType phoneNumber assignedSite email')
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });
      
    let validPayrolls = payrolls.filter(pr => pr.workerId !== null);
    
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.json([]);
      }
      validPayrolls = validPayrolls.filter(pr => {
        const wSiteId = pr.workerId.assignedSite?._id || pr.workerId.assignedSite;
        return wSiteId?.toString() === req.user.assignedSite.toString();
      });
    } else if (req.user.role === 'Admin' && querySiteId) {
      validPayrolls = validPayrolls.filter(pr => {
        const wSiteId = pr.workerId.assignedSite?._id || pr.workerId.assignedSite;
        return wSiteId?.toString() === querySiteId;
      });
    }
    
    res.json(validPayrolls);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Update advance deduction and recalculate net salary for a worker's payslip
// @route   PUT /api/payroll/:id/advance
// @access  Private/Admin
router.put('/:id/advance', protect, adminOnly, async (req, res) => {
  try {
    const { advanceDeduction, otherDeduction, bonus } = req.body;

    const payroll = await Payroll.findById(req.params.id)
      .populate('workerId', 'firstName lastName employeeId designation assignedSite email');
      
    if (!payroll) {
      return res.status(404).json({ message: 'Payroll record not found' });
    }

    const previousState = {
      advanceDeduction: payroll.advanceDeduction,
      otherDeduction: payroll.otherDeduction,
      bonus: payroll.bonus,
      netSalary: payroll.netSalary
    };

    if (advanceDeduction !== undefined) {
      payroll.advanceDeduction = Math.max(0, Number(advanceDeduction) || 0);
    }
    if (otherDeduction !== undefined) {
      payroll.otherDeduction = Math.max(0, Number(otherDeduction) || 0);
    }
    if (bonus !== undefined) {
      payroll.bonus = Math.max(0, Number(bonus) || 0);
    }

    // Recalculate Net Salary: Gross (Full + Half + OT + Bonus) - Advance - Other
    const baseSalary = payroll.baseSalary || 700;
    const fullDayPay = Math.round((payroll.presentDays || 0) * baseSalary);
    const halfDayPay = Math.round((payroll.halfDays || 0) * (baseSalary * 0.5));
    const overtimePay = Math.round(payroll.overtime || 0);
    const bonusPay = Math.round(payroll.bonus || 0);
    const grossEarnings = fullDayPay + halfDayPay + overtimePay + bonusPay;

    payroll.netSalary = Math.max(0, Math.round(grossEarnings - (payroll.advanceDeduction || 0) - (payroll.otherDeduction || 0)));
    const updated = await payroll.save();

    const populated = await Payroll.findById(updated._id)
      .populate('workerId', 'firstName lastName employeeId designation assignedSite email')
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    await logAudit({
      performedBy: req.user,
      actionType: 'PAYROLL_UPDATE',
      targetEntity: {
        entityType: 'Payroll',
        entityId: payroll._id.toString(),
        name: `Payroll for ${payroll.workerId?.firstName || 'Worker'} (${payroll.month}/${payroll.year})`
      },
      previousState,
      newState: {
        advanceDeduction: updated.advanceDeduction,
        netSalary: updated.netSalary
      },
      details: `Advance deduction of ₹${updated.advanceDeduction} applied for ${payroll.workerId?.firstName} ${payroll.workerId?.lastName}. Net salary recalculated from ₹${previousState.netSalary} to ₹${updated.netSalary} by ${req.user.name}`
    });

    res.json({ message: 'Advance deduction updated and net salary adjusted successfully', payroll: populated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== PDF GENERATION =====
const PDFDocument = require('pdfkit');
const { drawPayslip } = require('../utils/pdfHelper');

// @desc    Download single payslip PDF
// @route   GET /api/payroll/pdf/:id
// @access  Private/Admin or Supervisor
router.get('/pdf/:id', protect, adminOnly, async (req, res) => {
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
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

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
router.get('/pdf-all', protect, adminOnly, async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ message: 'Month and year required' });

  try {
    const query = { month: parseInt(month), year: parseInt(year) };
    if (payrollIds && Array.isArray(payrollIds) && payrollIds.length > 0) {
      query._id = { $in: payrollIds };
    }
    const payrolls = await Payroll.find(query)
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
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

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
  const { month, year, payrollIds } = req.body;
  if (!month || !year) return res.status(400).json({ message: 'Month and year required' });

  try {
    const query = { month: parseInt(month), year: parseInt(year) };
    if (payrollIds && Array.isArray(payrollIds) && payrollIds.length > 0) {
      query._id = { $in: payrollIds };
    }
    const payrolls = await Payroll.find(query)
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    const eligibleWorkers = payrolls.filter(pr => pr.workerId && pr.workerId.email);
    
    if (eligibleWorkers.length === 0) {
      return res.status(400).json({ message: 'No eligible workers with email addresses found.' });
    }

    const errors = [];
    let successCount = 0;
    const monthName = MONTH_NAMES[parseInt(month) - 1];

    for (let pr of eligibleWorkers) {
      try {
        const pdfBuffer = await generatePayslipBuffer(pr, monthName, year);
        await sendPayslipEmail(pr.workerId, pdfBuffer, monthName, year);
        successCount++;
      } catch (err) {
        console.error(`Failed to send email to ${pr.workerId.employeeId}:`, err);
        errors.push(`Failed for ${pr.workerId.firstName} (${pr.workerId.employeeId}): ${err.message}`);
      }
    }

    if (errors.length > 0) {
      return res.status(500).json({ 
        message: `Sent ${successCount} emails, but encountered errors: ${errors.join(' | ')}` 
      });
    }

    res.json({ message: `Successfully sent emails to all ${successCount} workers.` });

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

    const prevStatus = payroll.status;
    payroll.status = status;
    await payroll.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'PAYROLL_UPDATE',
      targetEntity: {
        entityType: 'Payroll',
        entityId: payroll._id.toString(),
        name: `Payroll ${payroll._id}`
      },
      previousState: { status: prevStatus },
      newState: { status },
      details: `Payroll status updated from ${prevStatus} to ${status} by ${req.user.name}`
    });

    res.json({ message: 'Payroll status updated successfully', payroll });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// @desc    Send a single payslip PDF to a worker via email (Resend)
// @route   POST /api/payroll/:id/send-email
// @access  Private/Admin
router.post('/:id/send-email', protect, adminOnly, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    if (!payroll || !payroll.workerId) {
      return res.status(404).json({ message: 'Payroll record or associated worker not found' });
    }

        // Allow updating worker email if provided in request body
    const { email } = req.body;
    if (email && email.trim()) {
      const cleanEmail = email.trim();
      await Worker.findByIdAndUpdate(payroll.workerId._id, { email: cleanEmail });
      payroll.workerId.email = cleanEmail;
    }

    if (!payroll.workerId.email) {
      return res.status(400).json({ 
        message: `Worker ${payroll.workerId.firstName} ${payroll.workerId.lastName || ''} has no registered email. Please provide an email address.` 
      });
    }

    const monthName = MONTH_NAMES[payroll.month - 1];
    const pdfBuffer = await generatePayslipBuffer(payroll, monthName, payroll.year);
    
    await sendPayslipEmail(payroll.workerId, pdfBuffer, monthName, payroll.year);

    try {
      await logAudit({
        performedBy: req.user,
        actionType: 'PAYROLL_EMAIL_SENT',
        targetEntity: {
          entityType: 'Payroll',
          entityId: payroll._id.toString(),
          name: `Payslip for ${payroll.workerId.firstName} ${payroll.workerId.lastName || ''} (${monthName} ${payroll.year})`
        },
        previousState: null,
        newState: { 
          recipient: payroll.workerId.email, 
          month: payroll.month, 
          year: payroll.year,
          netSalary: payroll.netSalary 
        },
        details: `Payslip PDF for ${monthName} ${payroll.year} successfully emailed to ${payroll.workerId.email} by ${req.user.name}`
      });
    } catch (auditErr) {
      console.warn('Non-fatal: Audit log creation failed for payslip email:', auditErr.message);
    }

    res.json({ 
      message: `Payslip successfully emailed to ${payroll.workerId.email}`,
      workerId: payroll.workerId._id,
      email: payroll.workerId.email,
    });
  } catch (error) {
    console.error('Error sending single payslip email:', error);
    res.status(500).json({ message: error.message || 'Failed to send payslip email' });
  }
});


module.exports = router;

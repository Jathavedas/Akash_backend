const express = require('express');
const router = express.Router();
const Payroll = require('../models/Payroll');
const Worker = require('../models/Worker');
const Attendance = require('../models/Attendance');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly } = require('../middlewares/roleMiddleware');

// @desc    Generate/Calculate payroll for a month
// @route   POST /api/payroll/generate
// @access  Private/Admin
router.post('/generate', protect, adminOnly, async (req, res) => {
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

        attendances.forEach(a => {
          if (a.status === 'Present') present++;
          else if (a.status === 'Absent') absent++;
        });

        let calculatedNet = 0;

        if (worker.salaryType === 'Monthly') {
          const perDay = worker.baseSalary / 30;
          calculatedNet = perDay * present;
        } else if (worker.salaryType === 'Daily') {
          calculatedNet = worker.baseSalary * present;
        }

        // Upsert Payroll
        const payroll = await Payroll.findOneAndUpdate(
          { workerId: worker._id, month, year },
          {
            presentDays: present,
            absentDays: absent,
            baseSalary: worker.baseSalary,
            netSalary: Math.max(0, calculatedNet),
            // overtime, bonus, deductions can be updated later via PUT
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
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
  const { month, year, workerId } = req.query;
  const query = {};
  if (month) query.month = parseInt(month, 10);
  if (year) query.year = parseInt(year, 10);
  if (workerId) query.workerId = workerId;

  try {
    const payrolls = await Payroll.find(query).populate('workerId', 'firstName lastName employeeId designation salaryType phoneNumber assignedSite').populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });
    const validPayrolls = payrolls.filter(pr => pr.workerId !== null);
    res.json(validPayrolls);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== PDF GENERATION =====
const PDFDocument = require('pdfkit');

// Helper: Draw a single payslip page onto a PDFDocument
function drawPayslip(doc, pr, monthName, year) {
  const w = pr.workerId;
  const pageW = doc.page.width;
  const leftMargin = 50;
  const rightEdge = pageW - 50;
  const colWidth = rightEdge - leftMargin;

  // --- Header ---
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e3a8a')
     .text('COOLNEST ENGINEERING SOLUTIONS', leftMargin, 50, { align: 'center', width: colWidth });
  doc.fontSize(10).font('Helvetica').fillColor('#555')
     .text('Construction Workforce Payroll Management', leftMargin, 75, { align: 'center', width: colWidth });

  // Divider
  doc.moveTo(leftMargin, 95).lineTo(rightEdge, 95).strokeColor('#1e3a8a').lineWidth(2).stroke();

  // Title
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
     .text(`PAYSLIP — ${monthName} ${year}`, leftMargin, 110, { align: 'center', width: colWidth });

  // --- Employee Details Box ---
  const boxY = 140;
  doc.roundedRect(leftMargin, boxY, colWidth, 90, 5).fillAndStroke('#f0f4ff', '#c7d2fe');

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Employee Name:', leftMargin + 15, boxY + 12);
  doc.font('Helvetica').text(`${w.firstName} ${w.lastName}`, leftMargin + 130, boxY + 12);

  doc.font('Helvetica-Bold').text('Employee ID:', leftMargin + 15, boxY + 30);
  doc.font('Helvetica').text(w.employeeId, leftMargin + 130, boxY + 30);

  doc.font('Helvetica-Bold').text('Designation:', leftMargin + 15, boxY + 48);
  doc.font('Helvetica').text(w.designation, leftMargin + 130, boxY + 48);

  doc.font('Helvetica-Bold').text('Site:', leftMargin + 300, boxY + 12);
  doc.font('Helvetica').text(w.assignedSite?.name || 'N/A', leftMargin + 370, boxY + 12);

  doc.font('Helvetica-Bold').text('Phone:', leftMargin + 300, boxY + 30);
  doc.font('Helvetica').text(w.phoneNumber || 'N/A', leftMargin + 370, boxY + 30);

  doc.font('Helvetica-Bold').text('Salary Type:', leftMargin + 300, boxY + 48);
  doc.font('Helvetica').text(w.salaryType, leftMargin + 370, boxY + 48);

  doc.font('Helvetica-Bold').text('Base Rate:', leftMargin + 15, boxY + 66);
  doc.font('Helvetica').text(`₹${pr.baseSalary}`, leftMargin + 130, boxY + 66);

  // --- Attendance Summary Table ---
  const tableY = boxY + 110;
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e3a8a').text('ATTENDANCE SUMMARY', leftMargin, tableY);

  const attY = tableY + 20;
  // Header row
  doc.roundedRect(leftMargin, attY, colWidth, 25, 3).fillAndStroke('#1e3a8a', '#1e3a8a');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
  doc.text('Present', leftMargin + 20, attY + 7);
  doc.text('Absent', leftMargin + 140, attY + 7);

  // Data row
  doc.roundedRect(leftMargin, attY + 25, colWidth, 25, 3).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.fillColor('#000').font('Helvetica').fontSize(10);
  doc.text(String(pr.presentDays), leftMargin + 35, attY + 32);
  doc.text(String(pr.absentDays), leftMargin + 155, attY + 32);

  // --- Earnings & Deductions ---
  const earningsY = attY + 75;
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e3a8a').text('EARNINGS & DEDUCTIONS', leftMargin, earningsY);

  const rows = [
    ['Base Salary / Rate', `₹${pr.baseSalary}`],
    ['Overtime', `₹${pr.overtime || 0}`],
    ['Bonus', `₹${pr.bonus || 0}`],
    ['Advance Deduction', `- ₹${pr.advanceDeduction || 0}`],
    ['Other Deduction', `- ₹${pr.otherDeduction || 0}`],
  ];

  let rowY = earningsY + 22;
  rows.forEach((row, i) => {
    const bgColor = i % 2 === 0 ? '#f8fafc' : '#ffffff';
    doc.rect(leftMargin, rowY, colWidth, 22).fillAndStroke(bgColor, '#e2e8f0');
    doc.fillColor('#333').font('Helvetica').fontSize(10);
    doc.text(row[0], leftMargin + 15, rowY + 5);
    doc.text(row[1], rightEdge - 120, rowY + 5, { width: 100, align: 'right' });
    rowY += 22;
  });

  // Net Salary
  doc.roundedRect(leftMargin, rowY, colWidth, 30, 3).fillAndStroke('#1e3a8a', '#1e3a8a');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13);
  doc.text('NET PAYABLE', leftMargin + 15, rowY + 8);
  doc.text(`₹${pr.netSalary.toFixed(2)}`, rightEdge - 140, rowY + 8, { width: 120, align: 'right' });

  // --- Footer ---
  const footerY = rowY + 60;
  doc.moveTo(leftMargin, footerY).lineTo(rightEdge, footerY).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.fillColor('#999').font('Helvetica').fontSize(8)
     .text('This is a computer-generated payslip. No signature required.', leftMargin, footerY + 8, { align: 'center', width: colWidth });
  doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, leftMargin, footerY + 20, { align: 'center', width: colWidth });
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// @desc    Download single payslip PDF
// @route   GET /api/payroll/pdf/:id
// @access  Private/Admin
router.get('/pdf/:id', protect, adminOnly, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    if (!payroll || !payroll.workerId) return res.status(404).json({ message: 'Payroll record or associated worker not found' });

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
// @access  Private/Admin
router.get('/pdf-all', protect, adminOnly, async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ message: 'Month and year required' });

  try {
    const payrolls = await Payroll.find({ month: parseInt(month), year: parseInt(year) })
      .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

    const validPayrolls = payrolls.filter(pr => pr.workerId !== null);

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

module.exports = router;


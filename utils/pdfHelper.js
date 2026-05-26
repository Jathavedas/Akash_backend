const PDFDocument = require('pdfkit');

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
  doc.font('Helvetica').text('Daily', leftMargin + 370, boxY + 48);

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

function generatePayslipBuffer(pr, monthName, year) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        let pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      drawPayslip(doc, pr, monthName, year);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  drawPayslip,
  generatePayslipBuffer
};

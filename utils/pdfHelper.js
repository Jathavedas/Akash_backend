const PDFDocument = require('pdfkit');

function formatCurrency(amount) {
  const val = Number(amount) || 0;
  return 'Rs. ' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawPayslip(doc, pr, monthName, year) {
  const w = pr.workerId || {};
  const pageW = doc.page.width;
  const leftMargin = 40;
  const rightMargin = pageW - 40;
  const contentWidth = rightMargin - leftMargin;

  // Colors
  const primaryDark = '#0f172a';    // Deep Slate / Obsidian
  const primaryNavy = '#1e3a8a';    // Executive Navy
  const accentBlue = '#2563eb';     // Vibrant Royal Blue
  const textDark = '#1e293b';       // Slate 800
  const textMuted = '#64748b';      // Slate 500
  const cardBg = '#f8fafc';         // Slate 50
  const cardBorder = '#e2e8f0';     // Slate 200
  const emeraldBg = '#ecfdf5';
  const emeraldText = '#065f46';
  const amberBg = '#fffbeb';
  const amberText = '#92400e';

  // --- 1. Top Decorative Brand Bar ---
  doc.rect(0, 0, pageW, 7).fill(accentBlue);

  // --- 2. Company Brand Header ---
  doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryDark)
     .text('COOLNEST ENGINEERING SOLUTIONS', leftMargin, 28, { align: 'left', width: contentWidth - 160 });

  doc.fontSize(8.5).font('Helvetica').fillColor(textMuted)
     .text('Workforce & Labour Management ERP  •  Official Pay Advice', leftMargin, 50, { align: 'left' });

  // Right-aligned Header Badge
  doc.roundedRect(rightMargin - 150, 26, 150, 32, 6).fillAndStroke('#eff6ff', '#bfdbfe');
  doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryNavy)
     .text('MONTHLY PAYSLIP', rightMargin - 150, 32, { align: 'center', width: 150 });
  doc.fontSize(8).font('Helvetica-Bold').fillColor(textDark)
     .text(`${monthName.toUpperCase()} ${year}`, rightMargin - 150, 44, { align: 'center', width: 150 });

  // Divider Line
  doc.moveTo(leftMargin, 68).lineTo(rightMargin, 68).strokeColor(cardBorder).lineWidth(1).stroke();

  // --- 3. Worker Details Executive Card ---
  const workerCardY = 76;
  const workerCardHeight = 84;
  doc.roundedRect(leftMargin, workerCardY, contentWidth, workerCardHeight, 6)
     .fillAndStroke(cardBg, cardBorder);

  // Left Column (Worker Identity)
  const col1X = leftMargin + 14;
  const col1ValX = col1X + 90;
  let lineY = workerCardY + 10;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Worker Name:', col1X, lineY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(textDark).text(`${w.firstName || ''} ${w.lastName || ''}`.trim() || 'N/A', col1ValX, lineY);

  lineY += 16;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Employee ID:', col1X, lineY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(primaryNavy).text(w.employeeId || 'N/A', col1ValX, lineY);

  lineY += 16;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Designation:', col1X, lineY);
  doc.font('Helvetica').fontSize(8.5).fillColor(textDark).text(w.designation || 'General Labour', col1ValX, lineY);

  lineY += 16;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Skill Category:', col1X, lineY);
  doc.font('Helvetica').fontSize(8.5).fillColor(textDark).text(w.skillCategory || 'Standard', col1ValX, lineY);

  // Right Column (Worksite & Financial Terms)
  const col2X = leftMargin + Math.floor(contentWidth / 2) + 10;
  const col2ValX = col2X + 85;
  lineY = workerCardY + 10;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Assigned Site:', col2X, lineY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(textDark).text(w.assignedSite?.name || 'Unassigned / Field', col2ValX, lineY, { width: 170, ellipsis: true });

  lineY += 16;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Mobile Number:', col2X, lineY);
  doc.font('Helvetica').fontSize(8.5).fillColor(textDark).text(w.phoneNumber || 'N/A', col2ValX, lineY);

  lineY += 16;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Salary Structure:', col2X, lineY);
  doc.font('Helvetica').fontSize(8.5).fillColor(textDark).text('Daily Wage Rate', col2ValX, lineY);

  lineY += 16;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textMuted).text('Daily Base Rate:', col2X, lineY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(emeraldText).text(`${formatCurrency(pr.baseSalary)} / day`, col2ValX, lineY);

  // --- 4. Attendance Metrics Four-Pill Summary ---
  const attY = workerCardY + workerCardHeight + 12;
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor(primaryDark).text('MONTHLY ATTENDANCE SUMMARY', leftMargin, attY);

  const pillY = attY + 16;
  const pillGap = 10;
  const pillWidth = Math.floor((contentWidth - (pillGap * 3)) / 4);
  const pillHeight = 44;

  const presentDays = pr.presentDays || 0;
  const halfDays = pr.halfDays || 0;
  const absentDays = pr.absentDays || 0;
  // Overtime hours stored in Attendance; if not in pr directly, estimate from OT amount / (baseSalary/8) or 0
  const hourlyRate = (pr.baseSalary || 700) / 8;
  const otHours = Math.round((pr.overtime || 0) / (hourlyRate || 1));

  // Pill 1: Full Days Present
  doc.roundedRect(leftMargin, pillY, pillWidth, pillHeight, 5).fillAndStroke(emeraldBg, '#a7f3d0');
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(emeraldText).text('FULL PRESENT', leftMargin, pillY + 7, { align: 'center', width: pillWidth });
  doc.fontSize(14).font('Helvetica-Bold').fillColor(emeraldText).text(String(presentDays), leftMargin, pillY + 20, { align: 'center', width: pillWidth });

  // Pill 2: Half Days
  const p2X = leftMargin + pillWidth + pillGap;
  doc.roundedRect(p2X, pillY, pillWidth, pillHeight, 5).fillAndStroke(amberBg, '#fde68a');
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(amberText).text('HALF DAYS', p2X, pillY + 7, { align: 'center', width: pillWidth });
  doc.fontSize(14).font('Helvetica-Bold').fillColor(amberText).text(String(halfDays), p2X, pillY + 20, { align: 'center', width: pillWidth });

  // Pill 3: Absent Days
  const p3X = p2X + pillWidth + pillGap;
  doc.roundedRect(p3X, pillY, pillWidth, pillHeight, 5).fillAndStroke('#fef2f2', '#fecaca');
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#991b1b').text('ABSENT DAYS', p3X, pillY + 7, { align: 'center', width: pillWidth });
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#991b1b').text(String(absentDays), p3X, pillY + 20, { align: 'center', width: pillWidth });

  // Pill 4: Overtime Hours
  const p4X = p3X + pillWidth + pillGap;
  doc.roundedRect(p4X, pillY, pillWidth, pillHeight, 5).fillAndStroke('#eff6ff', '#bfdbfe');
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(primaryNavy).text('OVERTIME (HOURS)', p4X, pillY + 7, { align: 'center', width: pillWidth });
  doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryNavy).text(`${otHours} hrs`, p4X, pillY + 20, { align: 'center', width: pillWidth });

  // --- 5. Itemized Earnings & Deductions Table ---
  const tableStartY = pillY + pillHeight + 16;
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor(primaryDark).text('EARNINGS & DEDUCTIONS BREAKDOWN', leftMargin, tableStartY);

  const thY = tableStartY + 16;
  doc.roundedRect(leftMargin, thY, contentWidth, 22, 4).fill(primaryDark);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('DESCRIPTION / PAY HEAD', leftMargin + 14, thY + 6);
  doc.text('CALCULATION DETAILS', leftMargin + 250, thY + 6);
  doc.text('AMOUNT', rightMargin - 110, thY + 6, { width: 100, align: 'right' });

  // Calculate items
  const baseSalary = pr.baseSalary || 0;
  const fullDayEarnings = presentDays * baseSalary;
  const halfDayEarnings = halfDays * (baseSalary * 0.5);
  const overtimePay = pr.overtime || 0;
  const bonus = pr.bonus || 0;
  const grossEarnings = fullDayEarnings + halfDayEarnings + overtimePay + bonus;

  const advanceDed = pr.advanceDeduction || 0;
  const otherDed = pr.otherDeduction || 0;
  const totalDeductions = advanceDed + otherDed;

  const rows = [
    { label: 'Full Day Wages', calc: `${presentDays} days × ${formatCurrency(baseSalary)}`, amt: formatCurrency(fullDayEarnings), isEarning: true },
    { label: 'Half Day Wages (0.5 rate)', calc: `${halfDays} half-day(s) × ${formatCurrency(baseSalary * 0.5)}`, amt: formatCurrency(halfDayEarnings), isEarning: true },
    { label: 'Overtime Wages (Integer Hrs)', calc: `${otHours} hours × ${formatCurrency(hourlyRate)}/hr`, amt: formatCurrency(overtimePay), isEarning: true },
    { label: 'Performance Bonus / Allowances', calc: 'Site & Performance Allowance', amt: formatCurrency(bonus), isEarning: true },
    { label: 'Advance Cash Deduction', calc: 'Field advance settlement', amt: `- ${formatCurrency(advanceDed)}`, isEarning: false },
    { label: 'Other Deductions / Penalties', calc: 'Standard site adjustments', amt: `- ${formatCurrency(otherDed)}`, isEarning: false },
  ];

  let currentY = thY + 22;
  const rowHeight = 22;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
    doc.rect(leftMargin, currentY, contentWidth, rowHeight).fillAndStroke(bg, cardBorder);

    doc.fontSize(8.5).font('Helvetica').fillColor(textDark).text(r.label, leftMargin + 14, currentY + 6);
    doc.fontSize(8).font('Helvetica').fillColor(textMuted).text(r.calc, leftMargin + 250, currentY + 6);

    const amtColor = r.isEarning ? (r.amt.startsWith('Rs. 0') ? textMuted : '#047857') : (r.amt.includes('- Rs. 0') ? textMuted : '#b91c1c');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(amtColor).text(r.amt, rightMargin - 110, currentY + 6, { width: 100, align: 'right' });

    currentY += rowHeight;
  });

  // Summary Row: Gross and Deductions
  doc.rect(leftMargin, currentY, contentWidth, 24).fillAndStroke('#f1f5f9', '#cbd5e1');
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(textDark)
     .text(`Gross Earnings: ${formatCurrency(grossEarnings)}`, leftMargin + 14, currentY + 7);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#b91c1c')
     .text(`Total Deductions: - ${formatCurrency(totalDeductions)}`, rightMargin - 220, currentY + 7, { width: 210, align: 'right' });

  currentY += 24;

  // --- 6. Executive NET PAYABLE Banner ---
  currentY += 10;
  const netHeight = 44;
  doc.roundedRect(leftMargin, currentY, contentWidth, netHeight, 6)
     .fillAndStroke(primaryDark, primaryNavy);

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#94a3b8')
     .text('NET SALARY DISBURSEMENT', leftMargin + 18, currentY + 11);
  doc.fontSize(7.5).font('Helvetica').fillColor('#64748b')
     .text('Payable via verified direct company payment', leftMargin + 18, currentY + 25);

  const netPayable = pr.netSalary !== undefined ? pr.netSalary : (grossEarnings - totalDeductions);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#38bdf8')
     .text(formatCurrency(Math.max(0, netPayable)), rightMargin - 230, currentY + 13, { width: 216, align: 'right' });

  currentY += netHeight + 20;

  // --- 7. Signatures & Official Disclaimer ---
  const sigY = currentY;
  const sigBoxW = Math.floor(contentWidth / 2) - 15;

  // Employer Verification
  doc.moveTo(leftMargin, sigY + 36).lineTo(leftMargin + sigBoxW, sigY + 36).strokeColor(textMuted).lineWidth(0.8).stroke();
  doc.fontSize(8).font('Helvetica-Bold').fillColor(textDark).text('COOLNEST ENGINEERING SOLUTIONS', leftMargin, sigY + 42);
  doc.fontSize(7).font('Helvetica').fillColor(textMuted).text('Authorised Human Resources & Accounts Signatory', leftMargin, sigY + 52);

  // Employee Acknowledgement
  const rightSigX = rightMargin - sigBoxW;
  doc.moveTo(rightSigX, sigY + 36).lineTo(rightMargin, sigY + 36).strokeColor(textMuted).lineWidth(0.8).stroke();
  doc.fontSize(8).font('Helvetica-Bold').fillColor(textDark).text('WORKER ACKNOWLEDGEMENT', rightSigX, sigY + 42);
  doc.fontSize(7).font('Helvetica').fillColor(textMuted).text('Signature / Date of Receipt Confirmation', rightSigX, sigY + 52);

  // --- 8. Executive Footer & System Seal ---
  const footerY = doc.page.height - 35;
  doc.moveTo(leftMargin, footerY - 8).lineTo(rightMargin, footerY - 8).strokeColor(cardBorder).lineWidth(0.5).stroke();
  doc.fontSize(7).font('Helvetica').fillColor(textMuted)
     .text('This is an official computer-generated document issued by Coolnest Workforce Operations ERP. No physical stamp required.', leftMargin, footerY, { align: 'center', width: contentWidth });
  doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8')
     .text(`Generated on: ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} | Status: ${pr.status || 'Approved'}`, leftMargin, footerY + 11, { align: 'center', width: contentWidth });
}

function generatePayslipBuffer(pr, monthName, year) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('error', reject);
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

const { Resend } = require('resend');
const nodemailer = require('nodemailer');

/**
 * Sends a monthly payslip PDF to a worker via Resend (HTTPS API) or Nodemailer (SMTP fallback).
 * Resend operates over standard HTTPS (port 443), so it works reliably on cloud hosts like Render.
 *
 * @param {Object} worker Worker document (contains email, firstName, lastName, employeeId)
 * @param {Buffer} pdfBuffer The generated PDF document buffer
 * @param {string} monthName Month string (e.g. 'October')
 * @param {number|string} year Year (e.g. 2026)
 */
async function sendPayslipEmail(worker, pdfBuffer, monthName, year) {
  if (!worker || !worker.email) {
    throw new Error(`Worker ${worker?.firstName || 'selected'} has no registered email address`);
  }

  const recipientEmail = worker.email.trim();
  const workerFullName = `${worker.firstName || 'Employee'} ${worker.lastName || ''}`.trim();
  const employeeId = worker.employeeId ? ` (ID: ${worker.employeeId})` : '';
  const pdfFilename = `Payslip_${worker.employeeId || worker.firstName || 'Worker'}_${monthName}_${year}.pdf`;

  // 1. Resend (Primary: uses HTTPS REST API, 100% works on Render)
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = process.env.RESEND_FROM || 'Coolnest Payroll <onboarding@resend.dev>';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
          .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); color: #ffffff; padding: 28px 24px; text-align: left; }
          .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
          .header p { margin: 4px 0 0; font-size: 13px; color: #93c5fd; }
          .content { padding: 28px 24px; }
          .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
          .message { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px; }
          .card { background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 20px 0; border: 1px solid #e2e8f0; }
          .card-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
          .card-row { font-size: 13px; padding: 4px 0; color: #334155; }
          .attachment-notice { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px 16px; margin-top: 20px; color: #1e40af; font-size: 13px; font-weight: 500; }
          .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Coolnest Engineering Solutions</h1>
            <p>Workforce Operations & Payroll Services</p>
          </div>
          <div class="content">
            <div class="greeting">Dear ${workerFullName}${employeeId},</div>
            <p class="message">
              Please find attached your official monthly payslip for <strong>${monthName} ${year}</strong>.
            </p>
            <div class="card">
              <div class="card-title">Payslip Details</div>
              <div class="card-row"><strong>Period:</strong> ${monthName} ${year}</div>
              <div class="card-row"><strong>Employee:</strong> ${workerFullName}</div>
              ${worker.employeeId ? `<div class="card-row"><strong>Employee ID:</strong> ${worker.employeeId}</div>` : ''}
              ${worker.designation ? `<div class="card-row"><strong>Designation:</strong> ${worker.designation}</div>` : ''}
            </div>
            <div class="attachment-notice">
              📄 Attached File: <strong>${pdfFilename}</strong>
            </div>
            <p class="message" style="margin-top: 24px; font-size: 13px;">
              If you have any questions regarding your attendance, overtime, advance deductions, or net salary disbursement, please contact your site supervisor or HR desk.
            </p>
          </div>
          <div class="footer">
            <p style="margin: 0;">Coolnest Engineering Solutions • Workforce Operations ERP</p>
            <p style="margin: 4px 0 0;">This is an automated, confidential payroll transmission.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const resendPayload = {
      from: fromAddress,
      to: [recipientEmail],
      subject: `Payslip for ${monthName} ${year} - Coolnest Engineering`,
      html: htmlContent,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBuffer,
        },
      ],
    };

    const result = await resend.emails.send(resendPayload);

    if (result.error) {
      console.error('Resend API returned an error:', result.error);
      throw new Error(result.error.message || 'Resend failed to send payslip email');
    }

    console.log(`Payslip email sent to ${recipientEmail} via Resend. ID:`, result.data?.id);
    return result;
  }

  // 2. Nodemailer Fallback (if SMTP credentials are provided)
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 465,
      secure: process.env.SMTP_PORT == 587 ? false : true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Coolnest HR" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: recipientEmail,
      subject: `Your Payslip for ${monthName} ${year}`,
      text: `Dear ${workerFullName},\n\nPlease find attached your payslip for the month of ${monthName} ${year}.\n\nBest Regards,\nCoolnest Engineering Solutions`,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBuffer,
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully via Nodemailer:', info.messageId);
    return info;
  }

  throw new Error('Email service not configured. Please add RESEND_API_KEY in your backend .env file or Render environment variables.');
}

module.exports = {
  sendPayslipEmail,
};

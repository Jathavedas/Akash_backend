const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 465,
  secure: process.env.SMTP_PORT == 587 ? false : true, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendPayslipEmail(worker, pdfBuffer, monthName, year) {
  if (!worker.email) {
    throw new Error(`Worker ${worker.firstName} has no email address`);
  }

  const mailOptions = {
    from: `"Coolnest HR" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: worker.email,
    subject: `Your Payslip for ${monthName} ${year}`,
    text: `Dear ${worker.firstName},\n\nPlease find attached your payslip for the month of ${monthName} ${year}.\n\nBest Regards,\nCoolnest Engineering Solutions`,
    attachments: [
      {
        filename: `Payslip_${monthName}_${year}.pdf`,
        content: pdfBuffer,
      },
    ],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

module.exports = {
  sendPayslipEmail
};

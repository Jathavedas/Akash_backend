const cron = require('node-cron');
const Payroll = require('../models/Payroll');
const { generatePayslipBuffer } = require('../utils/pdfHelper');
const { sendPayslipEmail } = require('../utils/emailService');

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Schedule to run at 23:59 on the last day of every month
cron.schedule('59 23 28-31 * *', async () => {
  const today = new Date();
  
  // Check if today is the last day of the month
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (tomorrow.getMonth() !== today.getMonth()) {
    console.log('Running end-of-month payroll email job...');
    
    const month = today.getMonth() + 1; // 1-12
    const year = today.getFullYear();
    const monthName = MONTH_NAMES[month - 1];

    try {
      const payrolls = await Payroll.find({ month, year })
        .populate({ path: 'workerId', populate: { path: 'assignedSite', select: 'name' } });

      for (let pr of payrolls) {
        if (pr.workerId && pr.workerId.email && pr.status !== 'Pending') {
          try {
            const pdfBuffer = await generatePayslipBuffer(pr, monthName, year);
            await sendPayslipEmail(pr.workerId, pdfBuffer, monthName, year);
            console.log(`Sent payslip to ${pr.workerId.email}`);
          } catch (err) {
            console.error(`Failed to send to ${pr.workerId.email}:`, err.message);
          }
        }
      }
      console.log('End-of-month payroll email job completed.');
    } catch (err) {
      console.error('Error running payroll email job:', err);
    }
  }
});

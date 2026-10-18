const express = require('express');
const router = express.Router();
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const Worker = require('../models/Worker');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly } = require('../middlewares/roleMiddleware');

// @desc    Get payroll & salary trend analytics (Past 6 months + Projected current month)
// @route   GET /api/analytics/payroll-trends
// @access  Private (Admin Only)
router.get('/payroll-trends', protect, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();
    const daysInCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();

    // 1. Gather historical data for past 6 months
    const monthsData = [];
    for (let i = 5; i >= 0; i--) {
      let targetMonth = currentMonth - i;
      let targetYear = currentYear;
      if (targetMonth <= 0) {
        targetMonth += 12;
        targetYear -= 1;
      }

      const monthName = new Date(targetYear, targetMonth - 1, 1).toLocaleString('default', { month: 'short' });
      const label = `${monthName} ${targetYear}`;

      // Query Payroll records for this month
      const payrolls = await Payroll.find({ month: targetMonth, year: targetYear });
      
      let totalNet = 0;
      let totalBase = 0;
      let totalOvertimePay = 0;
      let workersCount = payrolls.length;

      if (payrolls.length > 0) {
        payrolls.forEach(p => {
          totalNet += p.netSalary || 0;
          const basePart = (p.presentDays || 0) * (p.baseSalary || 0);
          totalBase += basePart;
          const otPart = (p.netSalary || 0) - basePart;
          totalOvertimePay += otPart > 0 ? otPart : 0;
        });
      } else {
        // If payroll hasn't been generated yet for current month, aggregate from live Attendance
        const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
        const endDate = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

        const attendances = await Attendance.find({
          date: { $gte: startDate, $lte: endDate }
        }).populate('workerId', 'baseSalary status');

        const workerMap = {};
        attendances.forEach(a => {
          if (!a.workerId) return;
          const wId = a.workerId._id.toString();
          if (!workerMap[wId]) {
            workerMap[wId] = {
              baseSalary: a.workerId.baseSalary || 700,
              presentDays: 0,
              overtimeHours: 0
            };
          }
          if (a.status === 'Present') workerMap[wId].presentDays += 1;
          workerMap[wId].overtimeHours += a.overtimeHours || 0;
        });

        workersCount = Object.keys(workerMap).length;
        Object.values(workerMap).forEach(w => {
          const base = w.presentDays * w.baseSalary;
          const hourlyRate = w.baseSalary / 8;
          const ot = w.overtimeHours * hourlyRate * 1.5;
          totalBase += base;
          totalOvertimePay += ot;
          totalNet += (base + ot);
        });
      }

      monthsData.push({
        month: targetMonth,
        year: targetYear,
        label,
        totalNet: Math.round(totalNet),
        totalBase: Math.round(totalBase),
        totalOvertimePay: Math.round(totalOvertimePay),
        workersCount
      });
    }

    // 2. Projected current month metrics
    const activeWorkers = await Worker.find({ status: 'Active' });
    const activeHeadcount = activeWorkers.length;
    const totalBaseSalarySum = activeWorkers.reduce((acc, w) => acc + (w.baseSalary || 750), 0);
    const avgDailyRate = activeHeadcount > 0 ? (totalBaseSalarySum / activeHeadcount) : 750;

    const currentMonthData = monthsData[monthsData.length - 1];
    const currentAccumulatedNet = currentMonthData ? currentMonthData.totalNet : 0;
    const currentAccumulatedOt = currentMonthData ? currentMonthData.totalOvertimePay : 0;

    // Run-rate projection
    const elapsedDays = Math.max(currentDay, 1);
    const remainingDays = daysInCurrentMonth - elapsedDays;
    const dailyRunRate = currentAccumulatedNet / elapsedDays;
    
    // Project end of month total
    const projectedTotalPayout = Math.round(currentAccumulatedNet + (dailyRunRate * remainingDays));
    const projectedOvertime = Math.round(currentAccumulatedOt + ((currentAccumulatedOt / elapsedDays) * remainingDays));

    res.json({
      historicalTrends: monthsData,
      projectedMetrics: {
        currentMonthLabel: new Date(currentYear, currentMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
        elapsedDays,
        daysInMonth: daysInCurrentMonth,
        activeHeadcount,
        avgDailyRate: Math.round(avgDailyRate),
        accumulatedPayoutSoFar: Math.round(currentAccumulatedNet),
        projectedTotalPayout,
        accumulatedOvertimeSoFar: Math.round(currentAccumulatedOt),
        projectedOvertime
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

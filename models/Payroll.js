const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  month: { type: Number, required: true }, // 1-12
  year: { type: Number, required: true },
  
  // Stats for the month
  presentDays: { type: Number, default: 0 },
  absentDays: { type: Number, default: 0 },
  
  // Financial specifics
  baseSalary: { type: Number, required: true }, // Rate used for calc
  overtime: { type: Number, default: 0 }, // Amount to add
  bonus: { type: Number, default: 0 }, // Additional perks
  advanceDeduction: { type: Number, default: 0 },
  otherDeduction: { type: Number, default: 0 },
  
  netSalary: { type: Number, required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Paid'], default: 'Pending' }
}, { timestamps: true });

// Ensure only 1 payroll entry per worker per month/year
payrollSchema.index({ workerId: 1, month: 1, year: 1 }, { unique: true });

// Auto-delete records older than 5 months (150 days)
payrollSchema.index({ createdAt: 1 }, { expireAfterSeconds: 150 * 24 * 60 * 60 });

module.exports = mongoose.model('Payroll', payrollSchema);

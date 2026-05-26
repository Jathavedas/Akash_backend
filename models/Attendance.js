const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  date: { type: Date, required: true },
  status: { type: String, enum: ['Present', 'Absent'], required: true },
  overtimeHours: { type: Number, default: 0 },
  markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Admin or Supervisor who marked it
}, { timestamps: true });

// Prevent duplicate attendance entry for same worker on same day
attendanceSchema.index({ workerId: 1, date: 1 }, { unique: true });

// Auto-delete records older than 5 months (150 days)
attendanceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 150 * 24 * 60 * 60 });

module.exports = mongoose.model('Attendance', attendanceSchema);

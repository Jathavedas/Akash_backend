const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  performedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    role: { type: String, required: true }
  },
  actionType: {
    type: String,
    required: true,
    enum: [
      'OVERTIME_UPDATE',
      'SITE_TRANSFER_REQUEST',
      'SITE_TRANSFER_APPROVAL',
      'SITE_TRANSFER_REJECT',
      'WORKER_CREATE',
      'WORKER_UPDATE',
      'WORKER_DELETE',
      'ATTENDANCE_OVERRIDE',
      'NAME_CORRECTION'
    ],
    index: true
  },
  targetEntity: {
    entityType: { type: String }, // 'Worker', 'Site', 'Attendance', 'TransferRequest'
    entityId: { type: String },
    name: { type: String }
  },
  previousState: { type: mongoose.Schema.Types.Mixed },
  newState: { type: mongoose.Schema.Types.Mixed },
  details: { type: String }
}, { timestamps: true });

// Auto expire logs after 365 days (1 year)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

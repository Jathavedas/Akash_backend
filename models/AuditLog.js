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
      'ATTENDANCE_MARK',
      'NAME_CORRECTION',
      'PAYROLL_GENERATE',
      'PAYROLL_UPDATE',
      'MATERIAL_CREATE',
      'MATERIAL_UPDATE',
      'MATERIAL_DELETE',
      'PURCHASE_CREATE',
      'PURCHASE_UPDATE',
      'PURCHASE_DELETE',
      'PAYMENT_CREATE',
      'PAYMENT_UPDATE',
      'PAYMENT_DELETE',
      'STOCK_USAGE_CREATE',
      'STOCK_USAGE_UPDATE',
      'STOCK_USAGE_DELETE'
    ],
    index: true
  },
  targetEntity: {
    entityType: { type: String }, // 'Worker', 'Site', 'Attendance', 'TransferRequest', 'Payroll', 'Material', 'Purchase', 'Payment', 'MaterialUsage'
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

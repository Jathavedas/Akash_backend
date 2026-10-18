const mongoose = require('mongoose');

const transferRequestSchema = new mongoose.Schema({
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  fromSite: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  toSite: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
  requestDate: { type: Date, default: Date.now },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('TransferRequest', transferRequestSchema);

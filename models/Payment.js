const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  paymentNumber: { type: String, unique: true, required: true },
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  supplierName: { type: String, required: true, trim: true, index: true },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase' },
  amount: { type: Number, required: true, min: 0.01 },
  paymentDate: { type: Date, required: true, default: Date.now, index: true },
  paymentMode: { 
    type: String, 
    enum: ['Bank Transfer (NEFT/RTGS)', 'UPI', 'Cheque', 'Cash', 'Credit Card', 'Other'], 
    default: 'Bank Transfer (NEFT/RTGS)' 
  },
  referenceNumber: { type: String, trim: true },
  notes: { type: String, trim: true },
  createdBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    role: { type: String, required: true }
  },
  updatedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    role: { type: String }
  }
}, { timestamps: true });

paymentSchema.index({ site: 1, paymentDate: -1 });
paymentSchema.index({ supplierName: 1, site: 1 });

module.exports = mongoose.model('Payment', paymentSchema);

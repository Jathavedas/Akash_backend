const mongoose = require('mongoose');

const materialUsageSchema = new mongoose.Schema({
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  materialName: { type: String, required: true, trim: true },
  quantityUsed: { type: Number, required: true, min: 0.0001 },
  unit: { type: String, required: true },
  usageDate: { type: Date, required: true, default: Date.now, index: true },
  purpose: { type: String, trim: true },
  usedByWorker: { type: String, trim: true },
  notes: { type: String, trim: true },
  createdBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    role: { type: String, required: true }
  }
}, { timestamps: true });

materialUsageSchema.index({ site: 1, usageDate: -1 });
materialUsageSchema.index({ site: 1, material: 1 });

module.exports = mongoose.model('MaterialUsage', materialUsageSchema);

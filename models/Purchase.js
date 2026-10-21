const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  purchaseNumber: { type: String, unique: true, required: true },
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  supplierName: { type: String, required: true, trim: true, index: true },
  supplierContact: { type: String, trim: true },
  invoiceNumber: { type: String, trim: true },
  purchaseDate: { type: Date, required: true, default: Date.now, index: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  materialName: { type: String, required: true, trim: true },
  unit: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0.0001 },
  ratePerUnit: { type: Number, required: true, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 }, // Automatic: Quantity * Rate per Unit
  status: { 
    type: String, 
    enum: ['Received', 'Ordered', 'Partial', 'Cancelled'], 
    default: 'Received' 
  },
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

// Enforce automatic calculation: Total = Quantity * Rate per Unit
purchaseSchema.pre('validate', function() {
  if (this.quantity != null && this.ratePerUnit != null) {
    this.totalAmount = Math.round((Number(this.quantity) * Number(this.ratePerUnit)) * 100) / 100;
  }
});

purchaseSchema.index({ site: 1, purchaseDate: -1 });
purchaseSchema.index({ supplierName: 1, site: 1 });

module.exports = mongoose.model('Purchase', purchaseSchema);

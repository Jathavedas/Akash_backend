const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { 
    type: String, 
    enum: [
      'Sheet Metal & Ducting',
      'Piping & Copper Tubes',
      'Insulation & Cladding',
      'Grilles, Diffusers & Dampers',
      'Fasteners & Hardware',
      'Electrical & Controls',
      'Refrigerants & Chemicals',
      'General Consumables',
      'Equipment & Machinery',
      'Other'
    ],
    default: 'Sheet Metal & Ducting'
  },
  unit: { 
    type: String, 
    required: true,
    enum: ['Sheets', 'Meters', 'Pieces', 'Kg', 'Rolls', 'Boxes', 'Liters', 'Sets', 'Coils', 'Bags', 'Pairs', 'Units'],
    default: 'Pieces'
  },
  minStockLevel: { type: Number, default: 10, min: 0 },
  standardRate: { type: Number, default: 0, min: 0 },
  description: { type: String, trim: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

materialSchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Material', materialSchema);

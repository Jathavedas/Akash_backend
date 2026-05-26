const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  project: { type: String, required: true },
  description: { type: String },
  status: { type: String, enum: ['Active', 'Completed', 'On Hold'], default: 'Active' },
}, { timestamps: true });

module.exports = mongoose.model('Site', siteSchema);

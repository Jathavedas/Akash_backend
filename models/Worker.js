const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
  photo: { type: String }, // URL from cloudinary or local
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  employeeId: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  email: { type: String },
  designation: { type: String, required: true },
  skillCategory: { type: String, enum: ['Skilled', 'Unskilled', 'Semi-Skilled'], required: true },
  assignedSite: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  joiningDate: { type: Date, required: true },
  salaryType: { type: String, enum: ['Daily'], default: 'Daily' },
  baseSalary: { type: Number, required: true }, // Daily rate
  address: { type: String },
  emergencyContact: { type: String },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

module.exports = mongoose.model('Worker', workerSchema);

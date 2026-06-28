const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
  photo: { type: String }, // URL from cloudinary or local
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  employeeId: { type: String, unique: true, sparse: true },
  phoneNumber: { type: String, required: true },
  email: { type: String },
  designation: { type: String, required: true },
  skillCategory: { type: String, enum: ['Skilled', 'Unskilled', 'Semi-Skilled'] },
  assignedSite: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  joiningDate: { type: Date, required: true },
  salaryType: { type: String, enum: ['Daily'], default: 'Daily' },
  baseSalary: { type: Number }, // Daily rate
  address: { type: String },
  emergencyContact: { type: String },
  status: { type: String, enum: ['Pending', 'Active', 'Inactive'], default: 'Pending' },
}, { timestamps: true });

module.exports = mongoose.model('Worker', workerSchema);

const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
  photo: { type: String }, // URL from cloudinary or local
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  employeeId: { type: String, unique: true, sparse: true, index: true },
  phoneNumber: { 
    type: String, 
    required: [true, 'Mobile number is required'], 
    unique: true, 
    index: true,
    validate: {
      validator: function(v) {
        return /^[6-9]\d{9}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit Indian mobile number.`
    }
  },
  email: { 
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (!v || v.trim() === '') return true;
        return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address.`
    }
  },
  designation: { type: String, required: true },
  skillCategory: { type: String, enum: ['Skilled', 'Unskilled', 'Semi-Skilled'] },
  assignedSite: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  transferStatus: { type: String, enum: ['None', 'Pending'], default: 'None' },
  pendingSite: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  joiningDate: { type: Date, required: true },
  salaryType: { type: String, enum: ['Daily'], default: 'Daily' },
  baseSalary: { type: Number }, // Daily rate
  address: { type: String },
  emergencyContact: { 
    type: String,
    validate: {
      validator: function(v) {
        if (!v || v.trim() === '') return true;
        return /^[6-9]\d{9}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit Indian mobile number for emergency contact.`
    }
  },
  status: { type: String, enum: ['Pending', 'Active', 'Inactive'], default: 'Pending' },
}, { timestamps: true });

// Pre-save hook: Any worker assigned or transferred to Demo unemployed is automatically set to Inactive
workerSchema.pre('save', async function(next) {
  try {
    if (this.assignedSite && (this.isModified('assignedSite') || this.isNew || this.isModified('status'))) {
      const Site = mongoose.model('Site');
      const site = await Site.findById(this.assignedSite).select('name');
      if (site && /demo\s*unemployed|unemployed/i.test(site.name)) {
        this.status = 'Inactive';
      }
    }
  } catch (err) {
    // continue if lookup fails
  }
  next();
});

module.exports = mongoose.model('Worker', workerSchema);

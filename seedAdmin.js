const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const adminExists = await User.findOne({ email: 'admin@coolnest.in' });
    if (adminExists) {
      console.log('Admin already exists!');
      process.exit();
    }
    
    await User.create({
      name: 'Global Admin',
      email: 'admin@coolnest.in',
      password: 'admin123',
      role: 'Admin'
    });
    console.log('Admin user seeded successfully!');
    process.exit();
  } catch (error) {
    console.error('Error seeding admin:', error.message);
    process.exit(1);
  }
};

seedAdmin();

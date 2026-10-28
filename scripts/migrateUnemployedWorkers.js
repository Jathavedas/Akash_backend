const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Site = require('../models/Site');
const Worker = require('../models/Worker');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const unemployedSites = await Site.find({ name: { $regex: /demo\s*unemployed|unemployed/i } });
    const siteIds = unemployedSites.map(s => s._id);
    console.log('Unemployed sites identified:', unemployedSites.map(s => ({ id: s._id.toString(), name: s.name })));

    const result = await Worker.updateMany(
      { assignedSite: { $in: siteIds } },
      { $set: { status: 'Inactive' } }
    );
    console.log(`Updated workers in Demo unemployed: matched=${result.matchedCount}, modified=${result.modifiedCount}`);

    const counts = await Worker.aggregate([
      { $match: { assignedSite: { $in: siteIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    console.log('Current status distribution in Demo unemployed:', counts);

    await mongoose.disconnect();
    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();

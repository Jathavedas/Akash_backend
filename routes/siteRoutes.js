const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly } = require('../middlewares/roleMiddleware');

// @desc    Get all sites (Public)
// @route   GET /api/sites/public
// @access  Public
router.get('/public', async (req, res) => {
  try {
    const sites = await Site.find().select('name location');
    res.json(sites);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get all sites
// @route   GET /api/sites
// @access  Private (Admin & Supervisor can view, but maybe supervisor shouldn't see all. We'll allow taking from query if needed)
router.get('/', protect, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.json([]);
      }
      query._id = req.user.assignedSite;
    }
    const sites = await Site.find(query);
    res.json(sites);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a site
// @route   POST /api/sites
// @access  Private/Admin
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const site = new Site(req.body);
    const createdSite = await site.save();
    res.status(201).json(createdSite);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a site
// @route   PUT /api/sites/:id
// @access  Private/Admin
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const site = await Site.findById(req.params.id);
    if (site) {
      Object.assign(site, req.body);
      const updatedSite = await site.save();
      res.json(updatedSite);
    } else {
      res.status(404).json({ message: 'Site not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete a site
// @route   DELETE /api/sites/:id
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const site = await Site.findByIdAndDelete(req.params.id);
    if (site) {
      res.json({ message: 'Site removed' });
    } else {
      res.status(404).json({ message: 'Site not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

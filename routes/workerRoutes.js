const express = require('express');
const router = express.Router();
const Worker = require('../models/Worker');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly, supervisorOrAdmin } = require('../middlewares/roleMiddleware');

// @desc    Get workers (filtered by site or all for admin)
// @route   GET /api/workers
// @access  Private (Admin or Supervisor)
router.get('/', protect, supervisorOrAdmin, async (req, res) => {
  try {
    let query = {};
    
    // If Supervisor, forcefully restrict to assigned site
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.status(403).json({ message: 'No site assigned to this supervisor' });
      }
      query.assignedSite = req.user.assignedSite;
    } else if (req.query.site) {
      // Admin can filter by site
      query.assignedSite = req.query.site;
    }

    // Optional filters
    if (req.query.status) query.status = req.query.status;
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { employeeId: searchRegex }
      ];
    }

    const workers = await Worker.find(query).populate('assignedSite', 'name location');
    res.json(workers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get worker by ID
// @route   GET /api/workers/:id
// @access  Private
router.get('/:id', protect, supervisorOrAdmin, async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id).populate('assignedSite', 'name location');
    if (!worker) return res.status(404).json({ message: 'Worker not found' });

    if (req.user.role === 'Supervisor' && worker.assignedSite._id.toString() !== req.user.assignedSite.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this worker' });
    }

    res.json(worker);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a worker
// @route   POST /api/workers
// @access  Private (Admin or Supervisor)
router.post('/', protect, supervisorOrAdmin, async (req, res) => {
  try {
    const workerData = req.body;
    
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.status(403).json({ message: 'No site assigned to this supervisor' });
      }
      workerData.assignedSite = req.user.assignedSite;
    }

    const worker = new Worker(workerData);
    const createdWorker = await worker.save();
    res.status(201).json(createdWorker);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a worker
// @route   PUT /api/workers/:id
// @access  Private/Admin
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (worker) {
      Object.assign(worker, req.body);
      const updatedWorker = await worker.save();
      res.json(updatedWorker);
    } else {
      res.status(404).json({ message: 'Worker not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete a worker
// @route   DELETE /api/workers/:id
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const worker = await Worker.findByIdAndDelete(req.params.id);
    if (worker) {
      res.json({ message: 'Worker removed' });
    } else {
      res.status(404).json({ message: 'Worker not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

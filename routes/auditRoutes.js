const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly } = require('../middlewares/roleMiddleware');

// @desc    Get audit logs with optional filters
// @route   GET /api/audit-logs
// @access  Private (Admin Only)
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { actionType, role, startDate, endDate, search, limit = 100, page = 1 } = req.query;
    const query = {};

    if (actionType) {
      query.actionType = actionType;
    }

    if (role) {
      query['performedBy.role'] = role;
    }

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.timestamp.$lte = end;
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { 'performedBy.name': searchRegex },
        { 'targetEntity.name': searchRegex },
        { details: searchRegex }
      ];
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const totalLogs = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parsedLimit);

    res.json({
      total: totalLogs,
      page: parsedPage,
      limit: parsedLimit,
      logs
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

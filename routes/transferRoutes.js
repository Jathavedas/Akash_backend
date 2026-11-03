const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const TransferRequest = require('../models/TransferRequest');
const Worker = require('../models/Worker');
const Site = require('../models/Site');
const { protect } = require('../middlewares/authMiddleware');
const { staffOnly, managerOrAdmin } = require('../middlewares/roleMiddleware');
const { normalizePhoneNumber } = require('../utils/phoneHelper');
const { logAudit } = require('../utils/auditLogger');

// Helper to identify Demo unemployed / unemployed site
const isUnemployedSite = (site) => {
  if (!site) return false;
  const name = typeof site === 'string' ? site : (site.name || '');
  return /demo\s*unemployed/i.test(name) || /unemployed/i.test(name);
};

// @desc    Initiate instant cross-site worker transfer
// @route   POST /api/transfers/request
// @access  Private (Supervisor, Manager, Admin)
router.post('/request', protect, staffOnly, async (req, res) => {
  try {
    const { identifier, targetSiteId, notes } = req.body;
    
    if (!identifier || !targetSiteId) {
      return res.status(400).json({ message: 'Worker Phone/ID and Target Site are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(targetSiteId)) {
      return res.status(400).json({ message: 'Invalid Target Site ID' });
    }

    // Supervisors can only request transfer to their assigned site
    if (req.user.role === 'Supervisor') {
      const userSiteId = (req.user.assignedSite?._id || req.user.assignedSite)?.toString();
      if (!userSiteId || userSiteId !== targetSiteId.toString()) {
        return res.status(403).json({ message: 'Supervisors can only request transfers to their assigned site' });
      }
    }

    const trimmedId = identifier.toString().trim();
    const cleanPhone = normalizePhoneNumber(trimmedId);
    // Escape regex special characters so inputs with '+', '(', etc. don't crash RegExp constructor
    const escapedId = trimmedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(`^${escapedId}$`, 'i');

    const orConditions = [{ employeeId: searchRegex }];

    // If identifier has 10 normalized digits, search by phone
    if (cleanPhone && cleanPhone.length === 10) {
      orConditions.push({ phoneNumber: cleanPhone });
    } else if (cleanPhone && cleanPhone.length > 10) {
      orConditions.push({ phoneNumber: cleanPhone.slice(-10) });
    }

    // Support numeric employee ID lookup (e.g. 12 -> EMP0012)
    if (/^\d{1,4}$/.test(trimmedId)) {
      const paddedId = `EMP${trimmedId.padStart(4, '0')}`;
      orConditions.push({ employeeId: new RegExp(`^${paddedId}$`, 'i') });
    }

    const worker = await Worker.findOne({
      $or: orConditions
    }).populate('assignedSite', 'name location');

    if (!worker) {
      return res.status(404).json({ message: 'No worker found with this Phone Number or Employee ID' });
    }

    const currentSiteId = (worker.assignedSite?._id || worker.assignedSite)?.toString();
    if (currentSiteId && currentSiteId === targetSiteId.toString()) {
      return res.status(400).json({ message: 'Worker is already permanently assigned to this project site' });
    }

    const targetSite = await Site.findById(targetSiteId);
    if (!targetSite) {
      return res.status(404).json({ message: 'Target project site not found' });
    }

    // Check if pending transfer already active for this site
    const existingPending = await TransferRequest.findOne({
      workerId: worker._id,
      toSite: targetSiteId,
      status: 'Pending'
    });

    if (existingPending) {
      worker.transferStatus = 'Pending';
      worker.pendingSite = targetSiteId;
      if (isUnemployedSite(targetSite)) {
        worker.status = 'Inactive';
      } else if (worker.status === 'Inactive') {
        worker.status = 'Active';
      }
      await worker.save();
      return res.status(200).json({ 
        message: 'Worker is already active on your site roster with "Transfer Pending" status. You can mark their attendance immediately without waiting for manager approval!',
        transferRequest: existingPending,
        worker
      });
    }

    // Supersede any older pending transfer for this worker to a different site
    await TransferRequest.updateMany(
      { workerId: worker._id, status: 'Pending' },
      { status: 'Superseded' }
    );

    const previousState = {
      assignedSite: currentSiteId,
      siteName: worker.assignedSite?.name || 'Unassigned',
      transferStatus: worker.transferStatus,
      pendingSite: worker.pendingSite
    };

    const transferRequest = await TransferRequest.create({
      workerId: worker._id,
      fromSite: currentSiteId || null,
      toSite: targetSiteId,
      requestedBy: req.user._id,
      status: 'Pending',
      notes: notes || 'Field cross-site deployment'
    });

    // Mark worker with pending transfer immediately
    worker.transferStatus = 'Pending';
    worker.pendingSite = targetSiteId;
    if (isUnemployedSite(targetSite)) {
      worker.status = 'Inactive';
    } else if (worker.status === 'Inactive') {
      worker.status = 'Active';
    }
    await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'SITE_TRANSFER_REQUEST',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${worker.firstName} ${worker.lastName} (${worker.employeeId || 'ID Pending'})`
      },
      previousState,
      newState: {
        assignedSite: currentSiteId,
        transferStatus: 'Pending',
        pendingSite: targetSiteId,
        targetSiteName: targetSite.name
      },
      details: `Transfer requested to site "${targetSite.name}" by ${req.user.name}. Attendance authorized immediately.`
    });

    res.status(201).json({
      message: 'Worker added to site roster with status "Transfer Pending". You can mark their attendance today immediately! Manager will approve according to availability.',
      transferRequest,
      worker
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get all transfer requests
// @route   GET /api/transfers
// @access  Private (Admin & Manager)
router.get('/', protect, managerOrAdmin, async (req, res) => {
  try {
    const query = {};
    if (req.query.status) {
      query.status = req.query.status;
    }

    const transfers = await TransferRequest.find(query)
      .sort({ createdAt: -1 })
      .populate('workerId', 'firstName lastName employeeId designation phoneNumber photo')
      .populate('fromSite', 'name location project')
      .populate('toSite', 'name location project')
      .populate('requestedBy', 'name email role')
      .populate('reviewedBy', 'name email role');

    res.json(transfers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Approve transfer request
// @route   PUT /api/transfers/:id/approve
// @access  Private (Admin & Manager)
router.put('/:id/approve', protect, managerOrAdmin, async (req, res) => {
  try {
    const transfer = await TransferRequest.findById(req.params.id)
      .populate('workerId')
      .populate('toSite', 'name')
      .populate('fromSite', 'name');

    if (!transfer) {
      return res.status(404).json({ message: 'Transfer request not found' });
    }

    if (transfer.status !== 'Pending') {
      return res.status(400).json({ message: `Transfer already ${transfer.status.toLowerCase()}` });
    }

    const workerId = transfer.workerId?._id || transfer.workerId;
    if (!workerId) {
      return res.status(404).json({ message: 'Associated worker not found' });
    }

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ message: 'Associated worker not found' });
    }

    const targetSiteId = transfer.toSite?._id || transfer.toSite;
    if (!targetSiteId) {
      return res.status(404).json({ message: 'Target project site not found' });
    }
    const targetSiteName = transfer.toSite?.name || 'Target Site';

    const previousState = {
      assignedSite: worker.assignedSite,
      transferStatus: worker.transferStatus,
      pendingSite: worker.pendingSite
    };

    transfer.status = 'Approved';
    transfer.reviewedBy = req.user._id;
    transfer.reviewedAt = new Date();
    await transfer.save();

    // Mark any other older pending transfers for this worker as Superseded
    await TransferRequest.updateMany(
      { workerId: worker._id, _id: { $ne: transfer._id }, status: 'Pending' },
      { status: 'Superseded' }
    );

    worker.assignedSite = targetSiteId;
    worker.transferStatus = 'None';
    worker.pendingSite = null;
    if (isUnemployedSite(transfer.toSite)) {
      worker.status = 'Inactive';
    } else if (worker.status === 'Inactive') {
      worker.status = 'Active';
    }
    await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'SITE_TRANSFER_APPROVAL',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${worker.firstName} ${worker.lastName} (${worker.employeeId || 'ID Pending'})`
      },
      previousState,
      newState: {
        assignedSite: targetSiteId,
        newSiteName: targetSiteName,
        transferStatus: 'None',
        pendingSite: null
      },
      details: `Transfer approved. Worker permanently reassigned to site "${targetSiteName}"`
    });

    res.json({ message: 'Transfer approved successfully. Worker primary site updated.', transfer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Reject transfer request
// @route   PUT /api/transfers/:id/reject
// @access  Private (Admin & Manager)
router.put('/:id/reject', protect, managerOrAdmin, async (req, res) => {
  try {
    const { notes } = req.body;
    const transfer = await TransferRequest.findById(req.params.id)
      .populate('workerId')
      .populate('toSite', 'name')
      .populate('fromSite', 'name');

    if (!transfer) {
      return res.status(404).json({ message: 'Transfer request not found' });
    }

    if (transfer.status !== 'Pending') {
      return res.status(400).json({ message: `Transfer already ${transfer.status.toLowerCase()}` });
    }

    const workerId = transfer.workerId?._id || transfer.workerId;
    const worker = workerId ? await Worker.findById(workerId) : null;
    const targetSiteId = (transfer.toSite?._id || transfer.toSite)?.toString();
    const targetSiteName = transfer.toSite?.name || 'Target Site';

    const previousState = {
      assignedSite: worker?.assignedSite,
      transferStatus: worker?.transferStatus,
      pendingSite: worker?.pendingSite
    };

    transfer.status = 'Rejected';
    transfer.reviewedBy = req.user._id;
    transfer.reviewedAt = new Date();
    if (notes) transfer.notes = notes;
    await transfer.save();

    if (worker) {
      // Only clear pending status if the worker was actually pending to THIS rejected site
      if (!worker.pendingSite || worker.pendingSite.toString() === targetSiteId) {
        worker.transferStatus = 'None';
        worker.pendingSite = null;
        await worker.save();
      }
    }

    await logAudit({
      performedBy: req.user,
      actionType: 'SITE_TRANSFER_REJECT',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker?._id?.toString() || workerId?.toString() || 'unknown',
        name: worker ? `${worker.firstName} ${worker.lastName}` : 'Worker'
      },
      previousState,
      newState: {
        transferStatus: worker?.transferStatus || 'None',
        pendingSite: worker?.pendingSite || null
      },
      details: `Transfer to site "${targetSiteName}" rejected by ${req.user.name}. Reason: ${notes || 'Not specified'}`
    });

    res.json({ message: 'Transfer request rejected. Primary deployment reverted while daily attendance is preserved.', transfer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

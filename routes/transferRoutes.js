const express = require('express');
const router = express.Router();
const TransferRequest = require('../models/TransferRequest');
const Worker = require('../models/Worker');
const Site = require('../models/Site');
const { protect } = require('../middlewares/authMiddleware');
const { staffOnly, managerOrAdmin } = require('../middlewares/roleMiddleware');
const { normalizePhoneNumber } = require('../utils/phoneHelper');
const { logAudit } = require('../utils/auditLogger');

// @desc    Initiate instant cross-site worker transfer
// @route   POST /api/transfers/request
// @access  Private (Supervisor, Manager, Admin)
router.post('/request', protect, staffOnly, async (req, res) => {
  try {
    const { identifier, targetSiteId, notes } = req.body;
    
    if (!identifier || !targetSiteId) {
      return res.status(400).json({ message: 'Worker Phone/ID and Target Site are required' });
    }

    // Supervisors can only request transfer to their assigned site
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite || req.user.assignedSite.toString() !== targetSiteId) {
        return res.status(403).json({ message: 'Supervisors can only request transfers to their assigned site' });
      }
    }

    const cleanPhone = normalizePhoneNumber(identifier);
    const searchRegex = new RegExp(`^${identifier.trim()}$`, 'i');

    const worker = await Worker.findOne({
      $or: [
        { phoneNumber: cleanPhone },
        { employeeId: searchRegex }
      ]
    }).populate('assignedSite', 'name location');

    if (!worker) {
      return res.status(404).json({ message: 'No worker found with this Phone Number or Employee ID' });
    }

    if (worker.assignedSite && worker.assignedSite._id.toString() === targetSiteId) {
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
      assignedSite: worker.assignedSite?._id,
      siteName: worker.assignedSite?.name,
      transferStatus: worker.transferStatus,
      pendingSite: worker.pendingSite
    };

    const transferRequest = await TransferRequest.create({
      workerId: worker._id,
      fromSite: worker.assignedSite?._id,
      toSite: targetSiteId,
      requestedBy: req.user._id,
      status: 'Pending',
      notes: notes || 'Field cross-site deployment'
    });

    // Mark worker with pending transfer immediately so supervisor can take attendance right away
    worker.transferStatus = 'Pending';
    worker.pendingSite = targetSiteId;
    await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'SITE_TRANSFER_REQUEST',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${worker.firstName} ${worker.lastName} (${worker.employeeId})`
      },
      previousState,
      newState: {
        assignedSite: worker.assignedSite?._id,
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

    const worker = await Worker.findById(transfer.workerId._id);
    if (!worker) {
      return res.status(404).json({ message: 'Associated worker not found' });
    }

    const previousState = {
      assignedSite: worker.assignedSite,
      transferStatus: worker.transferStatus,
      pendingSite: worker.pendingSite
    };

    transfer.status = 'Approved';
    transfer.reviewedBy = req.user._id;
    transfer.reviewedAt = new Date();
    await transfer.save();

    worker.assignedSite = transfer.toSite._id;
    worker.transferStatus = 'None';
    worker.pendingSite = null;
    await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'SITE_TRANSFER_APPROVAL',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${worker.firstName} ${worker.lastName} (${worker.employeeId})`
      },
      previousState,
      newState: {
        assignedSite: transfer.toSite._id,
        newSiteName: transfer.toSite.name,
        transferStatus: 'None',
        pendingSite: null
      },
      details: `Transfer approved. Worker permanently reassigned to site "${transfer.toSite.name}"`
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

    const worker = await Worker.findById(transfer.workerId._id);
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
      worker.transferStatus = 'None';
      worker.pendingSite = null;
      await worker.save();
    }

    await logAudit({
      performedBy: req.user,
      actionType: 'SITE_TRANSFER_REJECT',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker?._id?.toString() || 'unknown',
        name: worker ? `${worker.firstName} ${worker.lastName}` : 'Worker'
      },
      previousState,
      newState: {
        transferStatus: 'None',
        pendingSite: null
      },
      details: `Transfer to site "${transfer.toSite.name}" rejected by ${req.user.name}. Reason: ${notes || 'Not specified'}`
    });

    res.json({ message: 'Transfer request rejected. Primary deployment reverted while daily attendance is preserved.', transfer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Worker = require('../models/Worker');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly, managerOrAdmin, staffOnly } = require('../middlewares/roleMiddleware');
const { normalizePhoneNumber, isValidIndianMobile } = require('../utils/phoneHelper');
const { logAudit } = require('../utils/auditLogger');

// Helper to generate unique employee ID
const generateEmployeeId = async () => {
  const lastWorker = await Worker.findOne({ employeeId: { $regex: /^EMP/ } }).sort({ employeeId: -1 });
  let nextIdNum = 1;
  if (lastWorker && lastWorker.employeeId) {
    const lastId = lastWorker.employeeId.replace('EMP', '');
    const parsed = parseInt(lastId, 10);
    if (!isNaN(parsed)) {
      nextIdNum = parsed + 1;
    }
  }
  return `EMP${nextIdNum.toString().padStart(4, '0')}`;
};

// @desc    Get workers (filtered by site or all for admin/manager)
// @route   GET /api/workers
// @access  Private (Admin, Manager, Supervisor)
router.get('/', protect, staffOnly, async (req, res) => {
  try {
    let query = {};
    
    // If Supervisor, forcefully restrict strictly to assigned site
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) {
        return res.status(403).json({ message: 'No site assigned to this supervisor' });
      }
      query.assignedSite = req.user.assignedSite;
    } else if (req.query.site) {
      // Admin/Manager filtering by site: strictly show workers whose assignedSite matches this site
      query.assignedSite = req.query.site;
    }

    // Optional status filter
    if (req.query.status) query.status = req.query.status;

    // Optional search filter
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      const searchCondition = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { employeeId: searchRegex },
        { phoneNumber: searchRegex }
      ];
      if (query.assignedSite) {
        query = {
          assignedSite: query.assignedSite,
          $or: searchCondition
        };
      } else {
        query.$or = searchCondition;
      }
    }

    let workers = await Worker.find(query)
      .sort({ firstName: 1, lastName: 1 })
      .populate('assignedSite', 'name location project')
      .populate('pendingSite', 'name location project')
      .lean();

    // Financial Data Protection: Managers & Supervisors have ZERO financial access
    if (req.user.role === 'Manager' || req.user.role === 'Supervisor') {
      workers = workers.map(w => {
        delete w.baseSalary;
        delete w.salaryType;
        return w;
      });
    }

    res.json(workers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get worker by ID
// @route   GET /api/workers/:id
// @access  Private (Admin, Manager, Supervisor)
router.get('/:id', protect, staffOnly, async (req, res) => {
  try {
    let worker = await Worker.findById(req.params.id)
      .populate('assignedSite', 'name location')
      .populate('pendingSite', 'name location')
      .lean();

    if (!worker) {
      return res.status(404).json({ message: 'Worker not found' });
    }

    // Site Supervisor isolation
    if (req.user.role === 'Supervisor') {
      const isAssigned = worker.assignedSite?._id?.toString() === req.user.assignedSite?.toString();
      const isPending = worker.pendingSite?._id?.toString() === req.user.assignedSite?.toString();
      if (!isAssigned && !isPending) {
        return res.status(403).json({ message: 'Not authorized for this worker' });
      }
    }

    // Zero financial access for Managers and Supervisors
    if (req.user.role === 'Manager' || req.user.role === 'Supervisor') {
      delete worker.baseSalary;
      delete worker.salaryType;
    }

    res.json(worker);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a new worker (Strictly Admin and Manager; Supervisors BLOCKED)
// @route   POST /api/workers
// @access  Private (Admin & Manager Only)
router.post('/', protect, managerOrAdmin, async (req, res) => {
  try {
    const workerData = { ...req.body };

    // 1. Phone number normalization & strict validation
    const normalizedPhone = normalizePhoneNumber(workerData.phoneNumber);
    if (!isValidIndianMobile(normalizedPhone)) {
      return res.status(400).json({ 
        message: 'Invalid mobile number. Please provide a standard 10-digit Indian mobile number.' 
      });
    }
    workerData.phoneNumber = normalizedPhone;

    // 2. Strict De-Duplication check on Phone
    const existing = await Worker.findOne({ phoneNumber: normalizedPhone });
    if (existing) {
      return res.status(409).json({ 
        message: 'A worker profile with this mobile number is already registered. Please verify records or update the existing worker profile.' 
      });
    }

    // 3. Duplicate Worker Name Validation (Case-insensitive check)
    const trimmedFirst = (workerData.firstName || '').trim();
    const trimmedLast = (workerData.lastName || '').trim();
    if (!trimmedFirst) {
      return res.status(400).json({ message: 'Worker first name is required.' });
    }
    const escapedFirst = trimmedFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedLast = trimmedLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingName = await Worker.findOne({
      firstName: new RegExp(`^${escapedFirst}$`, 'i'),
      lastName: new RegExp(`^${escapedLast}$`, 'i')
    });
    if (existingName) {
      return res.status(400).json({
        message: `A worker named "${trimmedFirst} ${trimmedLast}" already exists in the system. Duplicate names are not allowed. Please add a last name, initial, or middle name (e.g., "${trimmedFirst} ${trimmedLast} (A)" or full surname) to differentiate.`
      });
    }

    // 4. Employee ID generation if not provided
    if (!workerData.employeeId) {
      workerData.employeeId = await generateEmployeeId();
    } else {
      const existingId = await Worker.findOne({ employeeId: workerData.employeeId });
      if (existingId) {
        return res.status(409).json({ message: 'Employee ID already exists. Please use a unique ID.' });
      }
    }

    // 5. Financial protection: Managers cannot set base salary
    if (req.user.role === 'Manager') {
      delete workerData.baseSalary;
      delete workerData.salaryType;
    }

    const worker = new Worker(workerData);
    const createdWorker = await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'WORKER_CREATE',
      targetEntity: {
        entityType: 'Worker',
        entityId: createdWorker._id.toString(),
        name: `${createdWorker.firstName} ${createdWorker.lastName} (${createdWorker.employeeId})`
      },
      previousState: null,
      newState: {
        firstName: createdWorker.firstName,
        lastName: createdWorker.lastName,
        employeeId: createdWorker.employeeId,
        phoneNumber: createdWorker.phoneNumber,
        designation: createdWorker.designation,
        assignedSite: createdWorker.assignedSite,
        status: createdWorker.status
      },
      details: `Worker ${createdWorker.firstName} ${createdWorker.lastName} added by ${req.user.name} (${req.user.role})`
    });

    res.status(201).json(createdWorker);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ 
        message: 'A worker with this phone number or employee ID already exists.' 
      });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a worker
// @route   PUT /api/workers/:id
// @access  Private (Admin & Manager)
router.put('/:id', protect, managerOrAdmin, async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) {
      return res.status(404).json({ message: 'Worker not found' });
    }

    const previousState = worker.toObject();
    const updateData = { ...req.body };

    // Phone normalization if phone number is being changed
    if (updateData.phoneNumber) {
      const cleanPhone = normalizePhoneNumber(updateData.phoneNumber);
      if (!isValidIndianMobile(cleanPhone)) {
        return res.status(400).json({ message: 'Invalid 10-digit Indian mobile number' });
      }
      // Check duplicate
      const duplicate = await Worker.findOne({ phoneNumber: cleanPhone, _id: { $ne: worker._id } });
      if (duplicate) {
        return res.status(409).json({ message: 'Another worker profile already exists with this phone number.' });
      }
      updateData.phoneNumber = cleanPhone;
    }

    // Check duplicate name if name is being changed
    if (updateData.firstName !== undefined || updateData.lastName !== undefined) {
      const targetFirst = (updateData.firstName !== undefined ? updateData.firstName : worker.firstName).trim();
      const targetLast = (updateData.lastName !== undefined ? updateData.lastName : worker.lastName).trim();
      const escapedFirst = targetFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedLast = targetLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicateName = await Worker.findOne({
        _id: { $ne: worker._id },
        firstName: new RegExp(`^${escapedFirst}$`, 'i'),
        lastName: new RegExp(`^${escapedLast}$`, 'i')
      });
      if (duplicateName) {
        return res.status(400).json({
          message: `Another worker named "${targetFirst} ${targetLast}" already exists in the system. Duplicate names are not allowed. Please add a last name or initial to differentiate.`
        });
      }
    }

    // Zero Financial Access: Managers CANNOT modify baseSalary
    if (req.user.role === 'Manager') {
      delete updateData.baseSalary;
      delete updateData.salaryType;
    }

    Object.assign(worker, updateData);
    const updatedWorker = await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'WORKER_UPDATE',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${worker.firstName} ${worker.lastName} (${worker.employeeId})`
      },
      previousState: {
        firstName: previousState.firstName,
        lastName: previousState.lastName,
        phoneNumber: previousState.phoneNumber,
        designation: previousState.designation,
        assignedSite: previousState.assignedSite,
        status: previousState.status
      },
      newState: {
        firstName: updatedWorker.firstName,
        lastName: updatedWorker.lastName,
        phoneNumber: updatedWorker.phoneNumber,
        designation: updatedWorker.designation,
        assignedSite: updatedWorker.assignedSite,
        status: updatedWorker.status
      },
      details: `Worker profile for ${updatedWorker.firstName} ${updatedWorker.lastName} updated by ${req.user.name} (${req.user.role})`
    });

    res.json(updatedWorker);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete a worker
// @route   DELETE /api/workers/:id
// @access  Private (Admin Only)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) {
      return res.status(404).json({ message: 'Worker not found' });
    }

    const previousState = worker.toObject();
    await Worker.findByIdAndDelete(req.params.id);
    // Cleanup attendance & payroll records
    await Attendance.deleteMany({ workerId: req.params.id });
    await Payroll.deleteMany({ workerId: req.params.id });

    await logAudit({
      performedBy: req.user,
      actionType: 'WORKER_DELETE',
      targetEntity: {
        entityType: 'Worker',
        entityId: req.params.id,
        name: `${previousState.firstName} ${previousState.lastName}`
      },
      previousState,
      newState: null,
      details: `Worker ${previousState.firstName} ${previousState.lastName} deleted by ${req.user.name} (${req.user.role})`
    });

    res.json({ message: 'Worker and associated records removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Public QR / Self-Service Onboarding
// @route   POST /api/workers/onboarding
// @access  Public
router.post('/onboarding', async (req, res) => {
  try {
    const workerData = { ...req.body };
    workerData.status = 'Pending';

    // 1. Phone number normalization & strict validation
    const normalizedPhone = normalizePhoneNumber(workerData.phoneNumber);
    if (!isValidIndianMobile(normalizedPhone)) {
      return res.status(400).json({ 
        message: 'Invalid mobile number. Please provide a standard 10-digit Indian mobile number.' 
      });
    }
    workerData.phoneNumber = normalizedPhone;

    // 2. Strict De-Duplication Engine Requirement
    const existing = await Worker.findOne({ phoneNumber: normalizedPhone });
    if (existing) {
      return res.status(409).json({ 
        message: 'A profile with this mobile number is already registered. Please contact your manager or verify your records via the Attendance Portal.' 
      });
    }

    // 3. Duplicate Worker Name Validation (Case-insensitive check)
    const trimmedFirst = (workerData.firstName || '').trim();
    const trimmedLast = (workerData.lastName || '').trim();
    if (!trimmedFirst) {
      return res.status(400).json({ message: 'First name is required.' });
    }
    const escapedFirst = trimmedFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedLast = trimmedLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingName = await Worker.findOne({
      firstName: new RegExp(`^${escapedFirst}$`, 'i'),
      lastName: new RegExp(`^${escapedLast}$`, 'i')
    });
    if (existingName) {
      return res.status(400).json({
        message: `A worker named "${trimmedFirst} ${trimmedLast}" already exists in the system. Duplicate names are not permitted. Please add a last name, initial, or middle name (e.g., "${trimmedFirst} ${trimmedLast} (A)" or full surname) to differentiate.`
      });
    }

    // 4. Generate unique employee ID
    if (!workerData.employeeId) {
      workerData.employeeId = await generateEmployeeId();
    }

    // Public onboarding cannot set salary
    delete workerData.baseSalary;
    delete workerData.salaryType;

    const worker = new Worker(workerData);
    const createdWorker = await worker.save();

    await logAudit({
      performedBy: { name: `${createdWorker.firstName} ${createdWorker.lastName}`, role: 'Public Self-Onboard' },
      actionType: 'WORKER_CREATE',
      targetEntity: {
        entityType: 'Worker',
        entityId: createdWorker._id.toString(),
        name: `${createdWorker.firstName} ${createdWorker.lastName}`
      },
      previousState: null,
      newState: {
        firstName: createdWorker.firstName,
        lastName: createdWorker.lastName,
        phoneNumber: createdWorker.phoneNumber,
        designation: createdWorker.designation,
        status: 'Pending'
      },
      details: `Worker self-registered via QR/Online Onboarding form`
    });

    res.status(201).json({
      message: 'Onboarding application submitted successfully',
      worker: createdWorker
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ 
        message: 'A profile with this mobile number is already registered. Please contact your manager or verify your records via the Attendance Portal.' 
      });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Approve a pending worker
// @route   PUT /api/workers/:id/approve
// @access  Private (Admin & Manager)
router.put('/:id/approve', protect, managerOrAdmin, async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) {
      return res.status(404).json({ message: 'Worker not found' });
    }

    const { baseSalary, assignedSite, skillCategory } = req.body;
    let { employeeId } = req.body;

    if (!assignedSite || !skillCategory) {
      return res.status(400).json({ message: 'Assigned Site and Skill Category are required for approval' });
    }

    if (!employeeId) {
      employeeId = await generateEmployeeId();
    }

    worker.status = 'Active';
    worker.employeeId = employeeId;
    // Admins can set base salary, managers set default or pass through
    if (req.user.role === 'Admin') {
      worker.baseSalary = baseSalary || 700;
    } else {
      worker.baseSalary = worker.baseSalary || 700;
    }
    worker.assignedSite = assignedSite;
    worker.skillCategory = skillCategory;

    const updatedWorker = await worker.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'WORKER_UPDATE',
      targetEntity: {
        entityType: 'Worker',
        entityId: worker._id.toString(),
        name: `${worker.firstName} ${worker.lastName} (${worker.employeeId})`
      },
      previousState: { status: 'Pending' },
      newState: { status: 'Active', assignedSite, skillCategory, employeeId },
      details: `Worker ${worker.firstName} ${worker.lastName} approved and activated by ${req.user.name} (${req.user.role})`
    });

    res.json(updatedWorker);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;

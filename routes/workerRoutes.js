const express = require('express');
const router = express.Router();
const Worker = require('../models/Worker');
const Site = require('../models/Site');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const TransferRequest = require('../models/TransferRequest');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly, managerOrAdmin, staffOnly } = require('../middlewares/roleMiddleware');
const { normalizePhoneNumber, isValidIndianMobile, validateMobileNumber } = require('../utils/phoneHelper');
const { validateEmail } = require('../utils/emailHelper');
const { logAudit } = require('../utils/auditLogger');

// Helper to identify Demo unemployed / unemployed site
const isUnemployedSite = async (siteId) => {
  if (!siteId) return false;
  try {
    const siteDoc = await Site.findById(siteId).select('name');
    if (!siteDoc) return false;
    return /demo\s*unemployed/i.test(siteDoc.name) || /unemployed/i.test(siteDoc.name);
  } catch {
    return false;
  }
};

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
    
    // Identify target site if supervisor or filtered by site
    const targetSiteId = req.user.role === 'Supervisor' 
      ? (req.user.assignedSite?._id || req.user.assignedSite) 
      : req.query.site;

    let siteCondition = null;
    if (targetSiteId) {
      siteCondition = {
        $or: [
          // 1. Worker permanently assigned here AND not actively transferred out to a different pending site
          {
            assignedSite: targetSiteId,
            $or: [
              { transferStatus: { $ne: 'Pending' } },
              { pendingSite: targetSiteId },
              { pendingSite: null },
              { pendingSite: { $exists: false } }
            ]
          },
          // 2. Worker has an active pending transfer TO this site (supervisor can give attendance immediately!)
          {
            pendingSite: targetSiteId,
            transferStatus: 'Pending'
          }
        ]
      };
    }

    // Status filter
    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    // Skill Category filter
    if (req.query.skillCategory && req.query.skillCategory !== 'all') {
      query.skillCategory = req.query.skillCategory;
    }

    // Designation filter
    if (req.query.designation && req.query.designation !== 'all') {
      query.designation = new RegExp(`^${req.query.designation.trim()}$`, 'i');
    }

    // Transfer Status filter
    if (req.query.transferStatus && req.query.transferStatus !== 'all') {
      query.transferStatus = req.query.transferStatus;
    }

    // Compensation/Wage filter (Admin only)
    if (req.user.role === 'Admin') {
      if (req.query.minSalary || req.query.maxSalary) {
        query.baseSalary = {};
        if (req.query.minSalary) query.baseSalary.$gte = Number(req.query.minSalary);
        if (req.query.maxSalary) query.baseSalary.$lte = Number(req.query.maxSalary);
      }
    }

    // Joining Date filter
    if (req.query.startDate || req.query.endDate) {
      query.joiningDate = {};
      if (req.query.startDate) query.joiningDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.joiningDate.$lte = end;
      }
    }

    // Search filter across name, ID, phone, email, and designation
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search.trim(), 'i');
      const searchCondition = {
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { employeeId: searchRegex },
          { phoneNumber: searchRegex },
          { email: searchRegex },
          { designation: searchRegex }
        ]
      };
      if (siteCondition) {
        query.$and = [
          siteCondition,
          searchCondition
        ];
      } else {
        query.$or = searchCondition.$or;
      }
    } else if (siteCondition) {
      Object.assign(query, siteCondition);
    }

    // Sorting support
    let sortObj = { firstName: 1, lastName: 1 };
    if (req.query.sortBy) {
      const dir = req.query.sortOrder === 'desc' ? -1 : 1;
      switch (req.query.sortBy) {
        case 'name':
          sortObj = { firstName: dir, lastName: dir };
          break;
        case 'employeeId':
          sortObj = { employeeId: dir };
          break;
        case 'designation':
          sortObj = { designation: dir };
          break;
        case 'skillCategory':
          sortObj = { skillCategory: dir };
          break;
        case 'status':
          sortObj = { status: dir };
          break;
        case 'joiningDate':
          sortObj = { joiningDate: dir };
          break;
        case 'baseSalary':
          if (req.user.role === 'Admin') {
            sortObj = { baseSalary: dir };
          }
          break;
        default:
          break;
      }
    }

    let workers = await Worker.find(query)
      .sort(sortObj)
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
    const phoneValidation = validateMobileNumber(workerData.phoneNumber, {
      required: true,
      fieldName: 'Worker mobile number'
    });
    if (!phoneValidation.isValid) {
      return res.status(400).json({ message: phoneValidation.error });
    }
    workerData.phoneNumber = phoneValidation.normalized;

    // 1b. Emergency contact validation (optional)
    if (workerData.emergencyContact && workerData.emergencyContact.toString().trim()) {
      const emergencyValidation = validateMobileNumber(workerData.emergencyContact, {
        required: false,
        fieldName: 'Emergency contact number',
        disallowSameAs: workerData.phoneNumber
      });
      if (!emergencyValidation.isValid) {
        return res.status(400).json({ message: emergencyValidation.error });
      }
      workerData.emergencyContact = emergencyValidation.normalized;
    } else {
      delete workerData.emergencyContact;
    }

    // 1c. Email validation (optional)
    if (workerData.email && workerData.email.toString().trim()) {
      const emailValidation = validateEmail(workerData.email, {
        required: false,
        fieldName: 'Worker email'
      });
      if (!emailValidation.isValid) {
        return res.status(400).json({ message: emailValidation.error });
      }
      workerData.email = emailValidation.normalized;
    } else {
      delete workerData.email;
    }

    // 2. Strict De-Duplication check on Phone
    const existing = await Worker.findOne({ phoneNumber: workerData.phoneNumber });
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

    // If assigned to Demo unemployed, worker status must be Inactive
    if (workerData.assignedSite && await isUnemployedSite(workerData.assignedSite)) {
      workerData.status = 'Inactive';
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
      const phoneValidation = validateMobileNumber(updateData.phoneNumber, {
        required: true,
        fieldName: 'Worker mobile number'
      });
      if (!phoneValidation.isValid) {
        return res.status(400).json({ message: phoneValidation.error });
      }
      // Check duplicate
      const duplicate = await Worker.findOne({ phoneNumber: phoneValidation.normalized, _id: { $ne: worker._id } });
      if (duplicate) {
        return res.status(409).json({ message: 'Another worker profile already exists with this mobile number.' });
      }
      updateData.phoneNumber = phoneValidation.normalized;
    }

    // Emergency contact normalization & validation
    if (updateData.emergencyContact !== undefined) {
      if (updateData.emergencyContact && updateData.emergencyContact.toString().trim()) {
        const primaryPhone = updateData.phoneNumber || worker.phoneNumber;
        const emergencyValidation = validateMobileNumber(updateData.emergencyContact, {
          required: false,
          fieldName: 'Emergency contact number',
          disallowSameAs: primaryPhone
        });
        if (!emergencyValidation.isValid) {
          return res.status(400).json({ message: emergencyValidation.error });
        }
        updateData.emergencyContact = emergencyValidation.normalized;
      } else {
        updateData.emergencyContact = '';
      }
    }

    // Email validation
    if (updateData.email !== undefined) {
      if (updateData.email && updateData.email.toString().trim()) {
        const emailValidation = validateEmail(updateData.email, {
          required: false,
          fieldName: 'Worker email'
        });
        if (!emailValidation.isValid) {
          return res.status(400).json({ message: emailValidation.error });
        }
        updateData.email = emailValidation.normalized;
      } else {
        updateData.email = '';
      }
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

    // If assignedSite is updated to Demo unemployed, set status to Inactive
    if (updateData.assignedSite && await isUnemployedSite(updateData.assignedSite)) {
      updateData.status = 'Inactive';
    } else if (!updateData.assignedSite && worker.assignedSite && await isUnemployedSite(worker.assignedSite)) {
      if (updateData.status !== 'Active') {
        updateData.status = 'Inactive';
      }
    }

    // If assignedSite is modified directly, resolve any pending cross-site transfers
    if (updateData.assignedSite && updateData.assignedSite.toString() !== (worker.assignedSite?.toString() || '')) {
      await TransferRequest.updateMany(
        { workerId: worker._id, status: 'Pending' },
        { status: 'Superseded' }
      );
      updateData.transferStatus = 'None';
      updateData.pendingSite = null;
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
    const phoneValidation = validateMobileNumber(workerData.phoneNumber, {
      required: true,
      fieldName: 'Mobile number'
    });
    if (!phoneValidation.isValid) {
      return res.status(400).json({ message: phoneValidation.error });
    }
    workerData.phoneNumber = phoneValidation.normalized;

    // 1b. Emergency contact validation
    if (workerData.emergencyContact && workerData.emergencyContact.toString().trim()) {
      const emergencyValidation = validateMobileNumber(workerData.emergencyContact, {
        required: false,
        fieldName: 'Emergency contact number',
        disallowSameAs: workerData.phoneNumber
      });
      if (!emergencyValidation.isValid) {
        return res.status(400).json({ message: emergencyValidation.error });
      }
      workerData.emergencyContact = emergencyValidation.normalized;
    } else {
      delete workerData.emergencyContact;
    }

    // 1c. Email validation (optional)
    if (workerData.email && workerData.email.toString().trim()) {
      const emailValidation = validateEmail(workerData.email, {
        required: false,
        fieldName: 'Email address'
      });
      if (!emailValidation.isValid) {
        return res.status(400).json({ message: emailValidation.error });
      }
      workerData.email = emailValidation.normalized;
    } else {
      delete workerData.email;
    }

    // 2. Strict De-Duplication Engine Requirement
    const existing = await Worker.findOne({ phoneNumber: workerData.phoneNumber });
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

    // If assigned to Demo unemployed, set Inactive instead of Active
    if (await isUnemployedSite(assignedSite)) {
      worker.status = 'Inactive';
    } else {
      worker.status = 'Active';
    }
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
      newState: { status: updatedWorker.status, assignedSite, skillCategory, employeeId },
      details: `Worker ${worker.firstName} ${worker.lastName} approved (${updatedWorker.status}) by ${req.user.name} (${req.user.role})`
    });

    res.json(updatedWorker);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;

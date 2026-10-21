const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Material = require('../models/Material');
const Purchase = require('../models/Purchase');
const Payment = require('../models/Payment');
const MaterialUsage = require('../models/MaterialUsage');
const Site = require('../models/Site');
const { protect } = require('../middlewares/authMiddleware');
const { adminOnly, managerOrAdmin, staffOnly } = require('../middlewares/roleMiddleware');
const { logAudit } = require('../utils/auditLogger');

// Helper to generate unique serial numbers
const generateSerial = async (Model, prefix, fieldName = 'purchaseNumber') => {
  const count = await Model.countDocuments();
  const year = new Date().getFullYear();
  const padded = String(count + 1).padStart(4, '0');
  return `${prefix}-${year}-${padded}`;
};

// Default seed catalog for HVAC & Engineering
const DEFAULT_CATALOG = [
  { name: 'GI Sheet 24 Gauge (0.63mm)', category: 'Sheet Metal & Ducting', unit: 'Sheets', minStockLevel: 25, standardRate: 920, description: 'IS 277 Lock-forming quality for rectangular ductwork' },
  { name: 'GI Sheet 22 Gauge (0.80mm)', category: 'Sheet Metal & Ducting', unit: 'Sheets', minStockLevel: 20, standardRate: 1180, description: 'High pressure duct fabrication' },
  { name: 'Copper Pipe 1/2" OD Hard Drawn', category: 'Piping & Copper Tubes', unit: 'Meters', minStockLevel: 40, standardRate: 460, description: 'Refrigerant line VRV/VRF suction pipe' },
  { name: 'Copper Pipe 3/4" OD Hard Drawn', category: 'Piping & Copper Tubes', unit: 'Meters', minStockLevel: 30, standardRate: 680, description: 'Refrigerant liquid line' },
  { name: 'Class 0 Nitrile Rubber Insulation 19mm', category: 'Insulation & Cladding', unit: 'Rolls', minStockLevel: 15, standardRate: 2450, description: 'Closed-cell thermal insulation for cold air ducts' },
  { name: 'Aluminium Foil Tape 50mm', category: 'Insulation & Cladding', unit: 'Rolls', minStockLevel: 30, standardRate: 190, description: 'Reinforced vapor barrier sealing tape' },
  { name: 'Linear Slot Diffuser 2-Slot 1200mm', category: 'Grilles, Diffusers & Dampers', unit: 'Pieces', minStockLevel: 12, standardRate: 1350, description: 'Architectural aluminum ceiling supply diffuser' },
  { name: 'Opposed Blade Damper (OBD) 450x450mm', category: 'Grilles, Diffusers & Dampers', unit: 'Pieces', minStockLevel: 10, standardRate: 880, description: 'Air volume balancing damper' },
  { name: 'Duct Hanger C-Clamp M10', category: 'Fasteners & Hardware', unit: 'Pieces', minStockLevel: 100, standardRate: 45, description: 'Ceiling structural beam clamp' },
  { name: 'Threaded Drop Rod M10 x 2M', category: 'Fasteners & Hardware', unit: 'Pieces', minStockLevel: 50, standardRate: 95, description: 'Galvanized duct suspension rod' },
  { name: 'Refrigerant R-410A Cylinder (11.3 kg)', category: 'Refrigerants & Chemicals', unit: 'Units', minStockLevel: 5, standardRate: 5800, description: 'Eco-friendly AC compressor refrigerant gas' },
  { name: 'Duct Synthetic Acoustic Adhesive (5L)', category: 'General Consumables', unit: 'Boxes', minStockLevel: 8, standardRate: 1650, description: 'FRP and insulation bonding compound' }
];

// ==========================================
// 1. MATERIALS CATALOG
// ==========================================

// @desc    Get all materials in catalog (auto-seeds if empty)
// @route   GET /api/materials/catalog
// @access  Private (Staff: Admin, Manager, Supervisor)
router.get('/catalog', protect, staffOnly, async (req, res) => {
  try {
    let materials = await Material.find().sort({ category: 1, name: 1 });
    if (materials.length === 0) {
      materials = await Material.insertMany(DEFAULT_CATALOG);
    }
    res.json(materials);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Add material to catalog
// @route   POST /api/materials/catalog
// @access  Private (Admin Only)
router.post('/catalog', protect, adminOnly, async (req, res) => {
  try {
    const { name, category, unit, minStockLevel, standardRate, description } = req.body;
    if (!name || !unit) {
      return res.status(400).json({ message: 'Material name and unit are required' });
    }

    const material = new Material({
      name: name.trim(),
      category: category || 'Sheet Metal & Ducting',
      unit,
      minStockLevel: Number(minStockLevel) || 10,
      standardRate: Number(standardRate) || 0,
      description
    });

    const saved = await material.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'MATERIAL_CREATE',
      targetEntity: { entityType: 'Material', entityId: saved._id.toString(), name: saved.name },
      newState: saved,
      details: `Material "${saved.name}" (${saved.unit}) created by ${req.user.name}`
    });

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update material
// @route   PUT /api/materials/catalog/:id
// @access  Private (Admin Only)
router.put('/catalog/:id', protect, adminOnly, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });

    const previousState = material.toObject();
    Object.assign(material, req.body);
    const updated = await material.save();

    await logAudit({
      performedBy: req.user,
      actionType: 'MATERIAL_UPDATE',
      targetEntity: { entityType: 'Material', entityId: updated._id.toString(), name: updated.name },
      previousState,
      newState: updated,
      details: `Material "${updated.name}" updated by ${req.user.name}`
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete material
// @route   DELETE /api/materials/catalog/:id
// @access  Private (Admin Only)
router.delete('/catalog/:id', protect, adminOnly, async (req, res) => {
  try {
    const material = await Material.findByIdAndDelete(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });

    await logAudit({
      performedBy: req.user,
      actionType: 'MATERIAL_DELETE',
      targetEntity: { entityType: 'Material', entityId: material._id.toString(), name: material.name },
      previousState: material,
      details: `Material "${material.name}" removed by ${req.user.name}`
    });

    res.json({ message: 'Material removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 2. PURCHASES / ADD ITEM TO SITE
// ==========================================

// @desc    Get purchases list with filters
// @route   GET /api/materials/purchases
// @access  Private (Supervisor sees assignedSite only, Manager/Admin see all or filtered)
router.get('/purchases', protect, staffOnly, async (req, res) => {
  try {
    const { site, material, supplier, startDate, endDate, status } = req.query;
    let query = {};

    // Site permission separation
    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) return res.json([]);
      query.site = req.user.assignedSite;
    } else if (site && site !== 'all') {
      query.site = site;
    }

    if (material && material !== 'all') {
      query.material = material;
    }

    if (supplier) {
      query.supplierName = new RegExp(supplier.trim(), 'i');
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate || endDate) {
      query.purchaseDate = {};
      if (startDate) query.purchaseDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.purchaseDate.$lte = end;
      }
    }

    const purchases = await Purchase.find(query)
      .populate('site', 'name location project')
      .populate('material', 'name category unit minStockLevel')
      .sort({ purchaseDate: -1, createdAt: -1 });

    res.json(purchases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create purchase record (Site-linked, Automatic Calculation Total = Qty * Rate)
// @route   POST /api/materials/purchases
// @access  Private (Admin Only)
router.post('/purchases', protect, adminOnly, async (req, res) => {
  try {
    const { site, supplierName, supplierContact, invoiceNumber, purchaseDate, material, materialName, itemName, unit, category, quantity, ratePerUnit, status, notes } = req.body;

    if (!site) {
      return res.status(400).json({ message: 'Site is required. Every material must be linked to a specific site.' });
    }

    const qty = Number(quantity);
    const rate = Number(ratePerUnit);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive number.' });
    }
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ message: 'Rate per unit must be a non-negative number.' });
    }

    // Lookup site
    const siteDoc = await Site.findById(site);
    if (!siteDoc) return res.status(404).json({ message: 'Selected Site not found.' });

    // Lookup or auto-create material doc
    let materialDoc = null;
    if (material && mongoose.Types.ObjectId.isValid(material)) {
      materialDoc = await Material.findById(material);
    }

    if (!materialDoc) {
      const nameToResolve = (itemName || materialName || material || '').trim();
      if (!nameToResolve) {
        return res.status(400).json({ message: 'Item / Material name is required.' });
      }
      materialDoc = await Material.findOne({ name: new RegExp('^' + nameToResolve + '$', 'i') });
      if (!materialDoc) {
        materialDoc = await Material.create({
          name: nameToResolve,
          category: category || 'Sheet Metal & Ducting',
          unit: unit || 'Pieces',
          standardRate: rate,
          minStockLevel: 10
        });
      }
    }

    // Automatic calculation: Total = Quantity * Rate per Unit
    const calculatedTotal = Math.round((qty * rate) * 100) / 100;
    const purchaseNumber = await generateSerial(Purchase, 'PO', 'purchaseNumber');

    const newPurchase = new Purchase({
      purchaseNumber,
      site,
      supplierName: (supplierName && supplierName.trim()) ? supplierName.trim() : 'Direct Purchase',
      supplierContact: supplierContact ? supplierContact.trim() : '',
      invoiceNumber: invoiceNumber ? invoiceNumber.trim() : '',
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      material: materialDoc._id,
      materialName: materialDoc.name,
      unit: materialDoc.unit,
      quantity: qty,
      ratePerUnit: rate,
      totalAmount: calculatedTotal,
      status: status || 'Received',
      notes: notes ? notes.trim() : '',
      createdBy: {
        userId: req.user._id,
        name: req.user.name,
        role: req.user.role
      }
    });

    const saved = await newPurchase.save();
    const populated = await Purchase.findById(saved._id)
      .populate('site', 'name location project')
      .populate('material', 'name category unit');

    // Audit History
    await logAudit({
      performedBy: req.user,
      actionType: 'PURCHASE_CREATE',
      targetEntity: { entityType: 'Purchase', entityId: saved._id.toString(), name: saved.purchaseNumber },
      newState: saved,
      details: `Item "${materialDoc.name}" (${qty} ${materialDoc.unit} @ ₹${rate} = ₹${calculatedTotal}) added to Site "${siteDoc.name}" by ${req.user.name}`
    });

    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update purchase record
// @route   PUT /api/materials/purchases/:id
// @access  Private (Admin Only)
router.put('/purchases/:id', protect, adminOnly, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase record not found' });

    const previousState = purchase.toObject();
    const { site, supplierName, supplierContact, invoiceNumber, purchaseDate, material, quantity, ratePerUnit, status, notes } = req.body;

    if (site) {
      const siteDoc = await Site.findById(site);
      if (!siteDoc) return res.status(404).json({ message: 'Site not found' });
      purchase.site = site;
    }

    if (supplierName) purchase.supplierName = supplierName.trim();
    if (supplierContact !== undefined) purchase.supplierContact = supplierContact.trim();
    if (invoiceNumber !== undefined) purchase.invoiceNumber = invoiceNumber.trim();
    if (purchaseDate) purchase.purchaseDate = new Date(purchaseDate);
    if (status) purchase.status = status;
    if (notes !== undefined) purchase.notes = notes.trim();

    if (material) {
      let materialDoc = null;
      if (mongoose.Types.ObjectId.isValid(material)) {
        materialDoc = await Material.findById(material);
      }
      if (materialDoc) {
        purchase.material = materialDoc._id;
        purchase.materialName = materialDoc.name;
        purchase.unit = materialDoc.unit;
      }
    }

    if (quantity != null) purchase.quantity = Number(quantity);
    if (ratePerUnit != null) purchase.ratePerUnit = Number(ratePerUnit);

    // Automatic calculation: Total = Quantity * Rate per Unit
    purchase.totalAmount = Math.round((Number(purchase.quantity) * Number(purchase.ratePerUnit)) * 100) / 100;
    purchase.updatedBy = {
      userId: req.user._id,
      name: req.user.name,
      role: req.user.role
    };

    const updated = await purchase.save();
    const populated = await Purchase.findById(updated._id)
      .populate('site', 'name location project')
      .populate('material', 'name category unit');

    // Audit History
    await logAudit({
      performedBy: req.user,
      actionType: 'PURCHASE_UPDATE',
      targetEntity: { entityType: 'Purchase', entityId: updated._id.toString(), name: updated.purchaseNumber },
      previousState,
      newState: updated,
      details: `Purchase ${updated.purchaseNumber} updated by ${req.user.name} (${req.user.role})`
    });

    res.json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete purchase record
// @route   DELETE /api/materials/purchases/:id
// @access  Private (Admin Only)
router.delete('/purchases/:id', protect, adminOnly, async (req, res) => {
  try {
    const purchase = await Purchase.findByIdAndDelete(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase record not found' });

    await logAudit({
      performedBy: req.user,
      actionType: 'PURCHASE_DELETE',
      targetEntity: { entityType: 'Purchase', entityId: purchase._id.toString(), name: purchase.purchaseNumber },
      previousState: purchase,
      details: `Purchase ${purchase.purchaseNumber} (Total ₹${purchase.totalAmount}) deleted by ${req.user.name}`
    });

    res.json({ message: 'Purchase record deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 3. PAYMENTS & OUTSTANDING CALCULATION
// ==========================================

// @desc    Get payments list
// @route   GET /api/materials/payments
// @access  Private (Staff)
router.get('/payments', protect, staffOnly, async (req, res) => {
  try {
    const { site, supplier, startDate, endDate } = req.query;
    let query = {};

    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) return res.json([]);
      query.site = req.user.assignedSite;
    } else if (site && site !== 'all') {
      query.site = site;
    }

    if (supplier) {
      query.supplierName = new RegExp(supplier.trim(), 'i');
    }

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.paymentDate.$lte = end;
      }
    }

    const payments = await Payment.find(query)
      .populate('site', 'name location project')
      .populate('purchase', 'purchaseNumber totalAmount materialName')
      .sort({ paymentDate: -1, createdAt: -1 });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create payment record (Linked to site & supplier)
// @route   POST /api/materials/payments
// @access  Private (Admin Only)
router.post('/payments', protect, adminOnly, async (req, res) => {
  try {
    const { site, supplierName, purchase, amount, paymentDate, paymentMode, referenceNumber, notes } = req.body;

    if (!site) {
      return res.status(400).json({ message: 'Site is required. Every payment must be linked to a specific site.' });
    }
    if (!supplierName || !supplierName.trim()) {
      return res.status(400).json({ message: 'Supplier name or Payee is required.' });
    }

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
    }

    const siteDoc = await Site.findById(site);
    if (!siteDoc) return res.status(404).json({ message: 'Site not found' });

    const paymentNumber = await generateSerial(Payment, 'PAY', 'paymentNumber');

    const newPayment = new Payment({
      paymentNumber,
      site,
      supplierName: supplierName.trim(),
      purchase: purchase || undefined,
      amount: Math.round(amt * 100) / 100,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMode: paymentMode || 'Bank Transfer (NEFT/RTGS)',
      referenceNumber: referenceNumber ? referenceNumber.trim() : '',
      notes: notes ? notes.trim() : '',
      createdBy: {
        userId: req.user._id,
        name: req.user.name,
        role: req.user.role
      }
    });

    const saved = await newPayment.save();
    const populated = await Payment.findById(saved._id)
      .populate('site', 'name location project')
      .populate('purchase', 'purchaseNumber totalAmount');

    // Audit History
    await logAudit({
      performedBy: req.user,
      actionType: 'PAYMENT_CREATE',
      targetEntity: { entityType: 'Payment', entityId: saved._id.toString(), name: saved.paymentNumber },
      newState: saved,
      details: `Payment ${saved.paymentNumber} of ₹${saved.amount} to "${saved.supplierName}" recorded for Site "${siteDoc.name}" by ${req.user.name}`
    });

    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update payment record
// @route   PUT /api/materials/payments/:id
// @access  Private (Admin Only)
router.put('/payments/:id', protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment record not found' });

    const previousState = payment.toObject();
    const { site, supplierName, purchase, amount, paymentDate, paymentMode, referenceNumber, notes } = req.body;

    if (site) {
      const siteDoc = await Site.findById(site);
      if (!siteDoc) return res.status(404).json({ message: 'Site not found' });
      payment.site = site;
    }
    if (supplierName) payment.supplierName = supplierName.trim();
    if (purchase !== undefined) payment.purchase = purchase || undefined;
    if (amount != null) payment.amount = Math.round(Number(amount) * 100) / 100;
    if (paymentDate) payment.paymentDate = new Date(paymentDate);
    if (paymentMode) payment.paymentMode = paymentMode;
    if (referenceNumber !== undefined) payment.referenceNumber = referenceNumber.trim();
    if (notes !== undefined) payment.notes = notes.trim();

    payment.updatedBy = {
      userId: req.user._id,
      name: req.user.name,
      role: req.user.role
    };

    const updated = await payment.save();
    const populated = await Payment.findById(updated._id)
      .populate('site', 'name location project')
      .populate('purchase', 'purchaseNumber totalAmount');

    await logAudit({
      performedBy: req.user,
      actionType: 'PAYMENT_UPDATE',
      targetEntity: { entityType: 'Payment', entityId: updated._id.toString(), name: updated.paymentNumber },
      previousState,
      newState: updated,
      details: `Payment ${updated.paymentNumber} updated by ${req.user.name}`
    });

    res.json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete payment record
// @route   DELETE /api/materials/payments/:id
// @access  Private (Admin Only)
router.delete('/payments/:id', protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment record not found' });

    await logAudit({
      performedBy: req.user,
      actionType: 'PAYMENT_DELETE',
      targetEntity: { entityType: 'Payment', entityId: payment._id.toString(), name: payment.paymentNumber },
      previousState: payment,
      details: `Payment ${payment.paymentNumber} (Amount ₹${payment.amount}) deleted by ${req.user.name}`
    });

    res.json({ message: 'Payment removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Financial & Outstanding Calculation (Outstanding = Total Purchase Amount - Total Payments)
// @route   GET /api/materials/financial-summary
// @access  Private (Staff)
router.get('/financial-summary', protect, staffOnly, async (req, res) => {
  try {
    const { site } = req.query;
    let siteFilter = {};

    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) return res.json({ sites: [], suppliers: [], totals: { totalPurchases: 0, totalPayments: 0, outstanding: 0 } });
      siteFilter._id = req.user.assignedSite;
    } else if (site && site !== 'all') {
      siteFilter._id = site;
    }

    const sites = await Site.find(siteFilter).sort({ name: 1 });
    const siteIds = sites.map(s => s._id);

    // Fetch purchases & payments for these sites
    const [purchases, payments] = await Promise.all([
      Purchase.find({ site: { $in: siteIds }, status: { $ne: 'Cancelled' } }).lean(),
      Payment.find({ site: { $in: siteIds } }).lean()
    ]);

    // 1. Site-wise breakdown
    const siteMap = {};
    sites.forEach(s => {
      siteMap[s._id.toString()] = {
        siteId: s._id,
        siteName: s.name,
        project: s.project,
        location: s.location,
        totalPurchases: 0,
        totalPayments: 0,
        outstanding: 0,
        purchaseCount: 0,
        paymentCount: 0
      };
    });

    purchases.forEach(p => {
      const sId = p.site?.toString();
      if (siteMap[sId]) {
        siteMap[sId].totalPurchases += Number(p.totalAmount) || 0;
        siteMap[sId].purchaseCount += 1;
      }
    });

    payments.forEach(pay => {
      const sId = pay.site?.toString();
      if (siteMap[sId]) {
        siteMap[sId].totalPayments += Number(pay.amount) || 0;
        siteMap[sId].paymentCount += 1;
      }
    });

    // Calculate Outstanding = Total Purchases - Total Payments for each site
    const siteSummaries = Object.values(siteMap).map(item => {
      const totPurchases = Math.round(item.totalPurchases * 100) / 100;
      const totPayments = Math.round(item.totalPayments * 100) / 100;
      const outstanding = Math.round((totPurchases - totPayments) * 100) / 100;
      return {
        ...item,
        totalPurchases: totPurchases,
        totalPayments: totPayments,
        outstanding: outstanding
      };
    });

    // 2. Supplier-wise breakdown
    const supplierMap = {};
    purchases.forEach(p => {
      const name = (p.supplierName || 'Unknown').trim();
      if (!supplierMap[name]) {
        supplierMap[name] = {
          supplierName: name,
          totalPurchases: 0,
          totalPayments: 0,
          outstanding: 0,
          purchaseCount: 0,
          paymentCount: 0,
          sites: new Set()
        };
      }
      supplierMap[name].totalPurchases += Number(p.totalAmount) || 0;
      supplierMap[name].purchaseCount += 1;
      if (p.site) supplierMap[name].sites.add(p.site.toString());
    });

    payments.forEach(pay => {
      const name = (pay.supplierName || 'Unknown').trim();
      if (!supplierMap[name]) {
        supplierMap[name] = {
          supplierName: name,
          totalPurchases: 0,
          totalPayments: 0,
          outstanding: 0,
          purchaseCount: 0,
          paymentCount: 0,
          sites: new Set()
        };
      }
      supplierMap[name].totalPayments += Number(pay.amount) || 0;
      supplierMap[name].paymentCount += 1;
      if (pay.site) supplierMap[name].sites.add(pay.site.toString());
    });

    const supplierSummaries = Object.values(supplierMap).map(item => {
      const totPurchases = Math.round(item.totalPurchases * 100) / 100;
      const totPayments = Math.round(item.totalPayments * 100) / 100;
      const outstanding = Math.round((totPurchases - totPayments) * 100) / 100;
      return {
        ...item,
        totalPurchases: totPurchases,
        totalPayments: totPayments,
        outstanding: outstanding,
        siteCount: item.sites.size,
        sites: undefined
      };
    }).sort((a, b) => b.outstanding - a.outstanding);

    // 3. Overall Totals
    const grandPurchases = siteSummaries.reduce((acc, s) => acc + s.totalPurchases, 0);
    const grandPayments = siteSummaries.reduce((acc, s) => acc + s.totalPayments, 0);
    const grandOutstanding = Math.round((grandPurchases - grandPayments) * 100) / 100;

    res.json({
      sites: siteSummaries,
      suppliers: supplierSummaries,
      totals: {
        totalPurchases: Math.round(grandPurchases * 100) / 100,
        totalPayments: Math.round(grandPayments * 100) / 100,
        outstanding: grandOutstanding,
        siteCount: siteSummaries.length,
        supplierCount: supplierSummaries.length
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 4. INVENTORY & STOCK TRACKING (Purchased, Used, Remaining)
// ==========================================

// @desc    Get Inventory tracking per site: Purchased, Used, Remaining Stock
// @route   GET /api/materials/inventory
// @access  Private (Staff)
router.get('/inventory', protect, staffOnly, async (req, res) => {
  try {
    const { site, material } = req.query;
    let siteFilter = {};

    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) return res.json([]);
      siteFilter._id = req.user.assignedSite;
    } else if (site && site !== 'all') {
      siteFilter._id = site;
    }

    const sites = await Site.find(siteFilter).sort({ name: 1 });
    const siteIds = sites.map(s => s._id);

    let purchaseQuery = { site: { $in: siteIds }, status: { $ne: 'Cancelled' } };
    let usageQuery = { site: { $in: siteIds } };

    if (material && material !== 'all') {
      purchaseQuery.material = material;
      usageQuery.material = material;
    }

    const [allMaterials, purchases, usages] = await Promise.all([
      Material.find().sort({ name: 1 }).lean(),
      Purchase.find(purchaseQuery).lean(),
      MaterialUsage.find(usageQuery).lean()
    ]);

    // Group by siteId + materialId
    const stockMap = {};

    const siteDict = {};
    sites.forEach(s => { siteDict[s._id.toString()] = s; });

    const materialDict = {};
    allMaterials.forEach(m => { materialDict[m._id.toString()] = m; });

    // Sum purchased quantity
    purchases.forEach(p => {
      const sId = p.site?.toString();
      const mId = p.material?.toString();
      if (!sId || !mId) return;

      const key = `${sId}_${mId}`;
      if (!stockMap[key]) {
        const mat = materialDict[mId] || { name: p.materialName, category: 'Other', unit: p.unit, minStockLevel: 10 };
        const st = siteDict[sId] || { name: 'Unknown' };
        stockMap[key] = {
          siteId: sId,
          siteName: st.name,
          project: st.project,
          materialId: mId,
          materialName: p.materialName || mat.name,
          category: mat.category,
          unit: p.unit || mat.unit,
          minStockLevel: mat.minStockLevel || 10,
          purchasedQuantity: 0,
          usedQuantity: 0,
          remainingStock: 0,
          totalCost: 0,
          lastRate: p.ratePerUnit || 0,
          lastSupplier: p.supplierName || '',
          lastPurchaseDate: null
        };
      }
      stockMap[key].purchasedQuantity += Number(p.quantity) || 0;
      stockMap[key].totalCost += Number(p.totalAmount) || 0;
      if (!stockMap[key].lastPurchaseDate || new Date(p.purchaseDate) > new Date(stockMap[key].lastPurchaseDate)) {
        stockMap[key].lastPurchaseDate = p.purchaseDate;
        stockMap[key].lastRate = p.ratePerUnit || stockMap[key].lastRate;
        stockMap[key].lastSupplier = p.supplierName || stockMap[key].lastSupplier;
      }
    });

    // Sum used quantity
    usages.forEach(u => {
      const sId = u.site?.toString();
      const mId = u.material?.toString();
      if (!sId || !mId) return;

      const key = `${sId}_${mId}`;
      if (!stockMap[key]) {
        const mat = materialDict[mId] || { name: u.materialName, category: 'Other', unit: u.unit, minStockLevel: 10 };
        const st = siteDict[sId] || { name: 'Unknown' };
        stockMap[key] = {
          siteId: sId,
          siteName: st.name,
          project: st.project,
          materialId: mId,
          materialName: u.materialName || mat.name,
          category: mat.category,
          unit: u.unit || mat.unit,
          minStockLevel: mat.minStockLevel || 10,
          purchasedQuantity: 0,
          usedQuantity: 0,
          remainingStock: 0,
          totalCost: 0,
          lastRate: 0,
          lastSupplier: '',
          lastPurchaseDate: null
        };
      }
      stockMap[key].usedQuantity += Number(u.quantityUsed) || 0;
    });

    // Calculate Remaining Stock = Purchased Quantity - Used Quantity
    const inventoryList = Object.values(stockMap).map(item => {
      const purchased = Math.round(item.purchasedQuantity * 100) / 100;
      const used = Math.round(item.usedQuantity * 100) / 100;
      const remaining = Math.round((purchased - used) * 100) / 100;

      let status = 'In Stock';
      if (remaining <= 0) {
        status = 'Depleted';
      } else if (remaining <= item.minStockLevel) {
        status = 'Low Stock';
      }

      return {
        ...item,
        purchasedQuantity: purchased,
        usedQuantity: used,
        remainingStock: remaining,
        status
      };
    }).sort((a, b) => a.siteName.localeCompare(b.siteName) || a.materialName.localeCompare(b.materialName));

    res.json(inventoryList);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get material usage logs
// @route   GET /api/materials/usage
// @access  Private (Staff)
router.get('/usage', protect, staffOnly, async (req, res) => {
  try {
    const { site, material, startDate, endDate } = req.query;
    let query = {};

    if (req.user.role === 'Supervisor') {
      if (!req.user.assignedSite) return res.json([]);
      query.site = req.user.assignedSite;
    } else if (site && site !== 'all') {
      query.site = site;
    }

    if (material && material !== 'all') {
      query.material = material;
    }

    if (startDate || endDate) {
      query.usageDate = {};
      if (startDate) query.usageDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.usageDate.$lte = end;
      }
    }

    const usages = await MaterialUsage.find(query)
      .populate('site', 'name location project')
      .populate('material', 'name category unit')
      .sort({ usageDate: -1, createdAt: -1 });

    res.json(usages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Log material consumption/usage
// @route   POST /api/materials/usage
// @access  Private (Admin, Manager, and Supervisor for their assignedSite)
router.post('/usage', protect, staffOnly, async (req, res) => {
  try {
    let { site, material, quantityUsed, usageDate, purpose, usedByWorker, notes } = req.body;

    if (req.user.role === 'Supervisor') {
      site = req.user.assignedSite;
    }

    if (!site) {
      return res.status(400).json({ message: 'Site is required to log material consumption.' });
    }
    if (!material) {
      return res.status(400).json({ message: 'Material is required.' });
    }

    const qty = Number(quantityUsed);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ message: 'Used quantity must be a positive number.' });
    }

    const siteDoc = await Site.findById(site);
    if (!siteDoc) return res.status(404).json({ message: 'Site not found.' });

    let materialDoc = null;
    if (mongoose.Types.ObjectId.isValid(material)) {
      materialDoc = await Material.findById(material);
    }
    if (!materialDoc) {
      materialDoc = await Material.findOne({ name: new RegExp('^' + material + '$', 'i') });
    }
    if (!materialDoc) return res.status(404).json({ message: 'Material not found.' });

    const usage = new MaterialUsage({
      site,
      material: materialDoc._id,
      materialName: materialDoc.name,
      quantityUsed: qty,
      unit: materialDoc.unit,
      usageDate: usageDate ? new Date(usageDate) : new Date(),
      purpose: purpose ? purpose.trim() : '',
      usedByWorker: usedByWorker ? usedByWorker.trim() : '',
      notes: notes ? notes.trim() : '',
      createdBy: {
        userId: req.user._id,
        name: req.user.name,
        role: req.user.role
      }
    });

    const saved = await usage.save();
    const populated = await MaterialUsage.findById(saved._id)
      .populate('site', 'name location project')
      .populate('material', 'name category unit');

    // Audit History
    await logAudit({
      performedBy: req.user,
      actionType: 'STOCK_USAGE_CREATE',
      targetEntity: { entityType: 'MaterialUsage', entityId: saved._id.toString(), name: materialDoc.name },
      newState: saved,
      details: `Material consumption: ${qty} ${materialDoc.unit} of "${materialDoc.name}" logged at Site "${siteDoc.name}" by ${req.user.name} (${purpose || 'Installation'})`
    });

    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete material usage entry
// @route   DELETE /api/materials/usage/:id
// @access  Private (Admin Only)
router.delete('/usage/:id', protect, adminOnly, async (req, res) => {
  try {
    const usage = await MaterialUsage.findByIdAndDelete(req.params.id);
    if (!usage) return res.status(404).json({ message: 'Usage record not found' });

    await logAudit({
      performedBy: req.user,
      actionType: 'STOCK_USAGE_DELETE',
      targetEntity: { entityType: 'MaterialUsage', entityId: usage._id.toString(), name: usage.materialName },
      previousState: usage,
      details: `Usage log of ${usage.quantityUsed} ${usage.unit} deleted by ${req.user.name}`
    });

    res.json({ message: 'Usage record deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 5. COMPREHENSIVE SITE REPORTS
// ==========================================

// @desc    Generate Site-wise comprehensive report (filtered by site, material, supplier, date)
// @route   GET /api/materials/reports
// @access  Private (Staff)
router.get('/reports', protect, staffOnly, async (req, res) => {
  try {
    const { site, material, supplier, startDate, endDate } = req.query;

    let targetSiteId = site;
    if (req.user.role === 'Supervisor') {
      targetSiteId = req.user.assignedSite?.toString();
    }

    if (!targetSiteId || targetSiteId === 'all') {
      return res.status(400).json({ message: 'Please select a specific site for the site-wise report.' });
    }

    const siteDoc = await Site.findById(targetSiteId);
    if (!siteDoc) return res.status(404).json({ message: 'Site not found' });

    let pQuery = { site: targetSiteId };
    if (material && material !== 'all') pQuery.material = material;
    if (supplier) pQuery.supplierName = new RegExp(supplier.trim(), 'i');

    let payQuery = { site: targetSiteId };
    if (supplier) payQuery.supplierName = new RegExp(supplier.trim(), 'i');

    let uQuery = { site: targetSiteId };
    if (material && material !== 'all') uQuery.material = material;

    if (startDate || endDate) {
      const dateRange = {};
      if (startDate) dateRange.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateRange.$lte = end;
      }
      pQuery.purchaseDate = dateRange;
      payQuery.paymentDate = dateRange;
      uQuery.usageDate = dateRange;
    }

    const [purchases, payments, usages] = await Promise.all([
      Purchase.find(pQuery).populate('material', 'name category unit').sort({ purchaseDate: -1 }),
      Payment.find(payQuery).sort({ paymentDate: -1 }),
      MaterialUsage.find(uQuery).sort({ usageDate: -1 })
    ]);

    const totalPurchases = purchases.reduce((acc, p) => acc + (Number(p.totalAmount) || 0), 0);
    const totalPayments = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const outstanding = Math.round((totalPurchases - totalPayments) * 100) / 100;

    const materialSummaryMap = {};
    purchases.forEach(p => {
      const mName = p.materialName;
      if (!materialSummaryMap[mName]) {
        materialSummaryMap[mName] = {
          materialName: mName,
          unit: p.unit,
          purchasedQuantity: 0,
          usedQuantity: 0,
          remainingStock: 0,
          totalSpend: 0
        };
      }
      materialSummaryMap[mName].purchasedQuantity += Number(p.quantity) || 0;
      materialSummaryMap[mName].totalSpend += Number(p.totalAmount) || 0;
    });

    usages.forEach(u => {
      const mName = u.materialName;
      if (!materialSummaryMap[mName]) {
        materialSummaryMap[mName] = {
          materialName: mName,
          unit: u.unit,
          purchasedQuantity: 0,
          usedQuantity: 0,
          remainingStock: 0,
          totalSpend: 0
        };
      }
      materialSummaryMap[mName].usedQuantity += Number(u.quantityUsed) || 0;
    });

    const materialSummary = Object.values(materialSummaryMap).map(m => ({
      ...m,
      purchasedQuantity: Math.round(m.purchasedQuantity * 100) / 100,
      usedQuantity: Math.round(m.usedQuantity * 100) / 100,
      remainingStock: Math.round((m.purchasedQuantity - m.usedQuantity) * 100) / 100,
      totalSpend: Math.round(m.totalSpend * 100) / 100
    }));

    res.json({
      site: {
        _id: siteDoc._id,
        name: siteDoc.name,
        location: siteDoc.location,
        project: siteDoc.project,
        status: siteDoc.status
      },
      summary: {
        totalPurchases: Math.round(totalPurchases * 100) / 100,
        totalPayments: Math.round(totalPayments * 100) / 100,
        outstanding,
        purchaseCount: purchases.length,
        paymentCount: payments.length,
        usageCount: usages.length,
        distinctMaterials: materialSummary.length
      },
      materialSummary,
      purchases,
      payments,
      usages
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 6. AUDIT HISTORY FOR MATERIALS & PURCHASES
// ==========================================

// @desc    Get audit history for material, purchase, payment, and stock usage records
// @route   GET /api/materials/audit
// @access  Private (Admin Only)
router.get('/audit', protect, adminOnly, async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog');
    const logs = await AuditLog.find({
      actionType: {
        $in: [
          'MATERIAL_CREATE', 'MATERIAL_UPDATE', 'MATERIAL_DELETE',
          'PURCHASE_CREATE', 'PURCHASE_UPDATE', 'PURCHASE_DELETE',
          'PAYMENT_CREATE', 'PAYMENT_UPDATE', 'PAYMENT_DELETE',
          'STOCK_USAGE_CREATE', 'STOCK_USAGE_UPDATE', 'STOCK_USAGE_DELETE'
        ]
      }
    })
    .sort({ timestamp: -1 })
    .limit(100);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

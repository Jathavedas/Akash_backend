const AuditLog = require('../models/AuditLog');

const logAudit = async ({ performedBy, actionType, targetEntity, previousState, newState, details }) => {
  try {
    await AuditLog.create({
      timestamp: new Date(),
      performedBy: {
        userId: performedBy?.id || performedBy?._id,
        name: performedBy?.name || 'System / Public',
        role: performedBy?.role || 'Public'
      },
      actionType,
      targetEntity,
      previousState,
      newState,
      details
    });
  } catch (err) {
    console.error('Audit log creation failed:', err.message);
  }
};

module.exports = { logAudit };

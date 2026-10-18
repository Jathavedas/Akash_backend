const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'Admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

const managerOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'Manager')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized: Admin or Manager privilege required' });
  }
};

const supervisorOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'Supervisor')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized to access this resource' });
  }
};

const staffOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'Manager' || req.user.role === 'Supervisor')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as system staff' });
  }
};

module.exports = { adminOnly, managerOrAdmin, supervisorOrAdmin, staffOnly };

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'Admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

const supervisorOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'Supervisor')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized to access this resource' });
  }
};

module.exports = { adminOnly, supervisorOrAdmin };

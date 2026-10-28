/**
 * Email Validation and Normalization Helper
 * Complies with RFC 5322 standard formats for web applications
 */

// Comprehensive and robust email regex pattern
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 * @param {string} email
 * @returns {string}
 */
const normalizeEmail = (email) => {
  if (!email) return '';
  return email.toString().trim().toLowerCase();
};

/**
 * Tests if an email matches standard RFC 5322 web patterns.
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (normalized.length > 254) return false;
  
  // Must match pattern and have a valid top-level domain of at least 2 characters
  if (!EMAIL_REGEX.test(normalized)) return false;
  
  const parts = normalized.split('@');
  if (parts.length !== 2) return false;
  
  const domain = parts[1];
  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  
  // TLD must be at least 2 alphabetic characters (e.g., com, org, in, io, co, etc.)
  if (!tld || tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
    return false;
  }
  
  return true;
};

/**
 * Validates an email and returns structured error messages.
 * @param {string} email
 * @param {object} options - { required, fieldName }
 * @returns {{ isValid: boolean, error: string | null, normalized: string }}
 */
const validateEmail = (email, options = {}) => {
  const { required = true, fieldName = 'Email address' } = options;
  const rawStr = email ? email.toString().trim() : '';

  if (!rawStr) {
    if (required) {
      return {
        isValid: false,
        error: `${fieldName} is required.`,
        normalized: ''
      };
    }
    return { isValid: true, error: null, normalized: '' };
  }

  const normalized = normalizeEmail(rawStr);

  if (normalized.length > 254) {
    return {
      isValid: false,
      error: `${fieldName} exceeds maximum allowable length of 254 characters.`,
      normalized
    };
  }

  if (!normalized.includes('@')) {
    return {
      isValid: false,
      error: `${fieldName} is missing the '@' symbol (e.g. user@example.com).`,
      normalized
    };
  }

  const parts = normalized.split('@');
  if (parts.length > 2 || !parts[0] || !parts[1]) {
    return {
      isValid: false,
      error: `${fieldName} format is invalid. Please check username and domain parts.`,
      normalized
    };
  }

  if (!parts[1].includes('.')) {
    return {
      isValid: false,
      error: `${fieldName} domain is missing an extension (e.g. .com, .in, .org).`,
      normalized
    };
  }

  if (!isValidEmail(normalized)) {
    return {
      isValid: false,
      error: `Please enter a valid ${fieldName.toLowerCase()} (e.g. user@domain.com).`,
      normalized
    };
  }

  return { isValid: true, error: null, normalized };
};

module.exports = {
  EMAIL_REGEX,
  normalizeEmail,
  isValidEmail,
  validateEmail
};

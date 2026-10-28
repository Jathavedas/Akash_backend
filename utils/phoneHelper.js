/**
 * Phone Number Validation and Normalization Helper
 * Follows Telecommunications Regulatory Authority of India (TRAI) standards
 * Valid Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9.
 */

const normalizePhoneNumber = (rawPhone) => {
  if (!rawPhone) return '';
  // Strip all non-digit characters
  let digits = rawPhone.toString().replace(/\D/g, '');
  
  // Handle country codes and prefixes:
  // 13 digits starting with 910 (e.g. +91 0 9876543210)
  if (digits.length === 13 && digits.startsWith('910')) {
    digits = digits.substring(3);
  }
  // 12 digits starting with 91 (e.g. +91 9876543210 or 919876543210)
  else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  }
  // 11 digits starting with 0 (e.g. 09876543210)
  else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  
  return digits;
};

const isValidIndianMobile = (phone) => {
  if (!phone) return false;
  const normalized = normalizePhoneNumber(phone);
  // Must be strictly 10 digits starting with 6, 7, 8, or 9
  return /^[6-9]\d{9}$/.test(normalized);
};

/**
 * Validates a mobile number and returns a structured validation result.
 * @param {string} phone - Raw or formatted phone number
 * @param {object} options - Options including required, fieldName, and disallowSameAs
 * @returns {{ isValid: boolean, error: string | null, normalized: string }}
 */
const validateMobileNumber = (phone, options = {}) => {
  const { 
    required = true, 
    fieldName = 'Mobile number', 
    disallowSameAs = null 
  } = options;

  if (!phone || !phone.toString().trim()) {
    if (required) {
      return { 
        isValid: false, 
        error: `${fieldName} is required.`, 
        normalized: '' 
      };
    }
    return { isValid: true, error: null, normalized: '' };
  }

  const normalized = normalizePhoneNumber(phone);

  if (normalized.length === 0) {
    return { 
      isValid: false, 
      error: `Please enter a valid ${fieldName.toLowerCase()} containing numeric digits.`, 
      normalized 
    };
  }

  if (normalized.length < 10) {
    return { 
      isValid: false, 
      error: `${fieldName} is too short (${normalized.length}/10 digits). Standard Indian mobile numbers require 10 digits.`, 
      normalized 
    };
  }

  if (normalized.length > 10) {
    return { 
      isValid: false, 
      error: `${fieldName} is too long (${normalized.length} digits). Please provide a 10-digit mobile number without international prefixes.`, 
      normalized 
    };
  }

  if (!/^[6-9]/.test(normalized)) {
    return { 
      isValid: false, 
      error: `${fieldName} must start with 6, 7, 8, or 9 according to the Indian National Numbering Plan.`, 
      normalized 
    };
  }

  if (disallowSameAs && normalized === normalizePhoneNumber(disallowSameAs)) {
    return {
      isValid: false,
      error: `${fieldName} cannot be identical to the primary mobile number.`,
      normalized
    };
  }

  return { isValid: true, error: null, normalized };
};

/**
 * Format a 10-digit normalized phone number for clean UI display.
 * Example: '9876543210' -> '+91 98765 43210'
 */
const formatIndianMobile = (phone) => {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length === 10) {
    return `+91 ${normalized.slice(0, 5)} ${normalized.slice(5)}`;
  }
  return phone || '';
};

module.exports = { 
  normalizePhoneNumber, 
  isValidIndianMobile, 
  validateMobileNumber,
  formatIndianMobile
};

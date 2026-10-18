const normalizePhoneNumber = (rawPhone) => {
  if (!rawPhone) return '';
  // Strip non-digits
  let digits = rawPhone.toString().replace(/\D/g, '');
  
  // Handle country code +91
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  
  return digits;
};

const isValidIndianMobile = (phone) => {
  const normalized = normalizePhoneNumber(phone);
  // Must be 10 digits starting with 6, 7, 8, or 9
  return /^[6-9]\d{9}$/.test(normalized);
};

module.exports = { normalizePhoneNumber, isValidIndianMobile };

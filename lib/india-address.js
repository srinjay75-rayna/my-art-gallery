export const INDIAN_STATES_UTS = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
];

export function normaliseIndianPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  return digits.slice(-10);
}

export function isCompleteIndianAddress(value, { includeContact = true } = {}) {
  const required = ['address','landmark','locality','city','state','pincode'];
  if (includeContact) required.push('full_name','phone');
  return required.every((key) => String(value?.[key] || '').trim()) && /^\d{6}$/.test(String(value?.pincode || '')) && (!includeContact || /^\d{10}$/.test(normaliseIndianPhone(value?.phone)));
}

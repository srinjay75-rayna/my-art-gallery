const roundUpRupee = (value) => Math.ceil(Math.max(0, Number(value) || 0));

const FORMAT_FACTORS = [
  { match: /rolled canvas|protective tube|tube/i, factor: 1.12 },
  { match: /fine-art paper|print/i, factor: 0.92 },
  { match: /framed/i, factor: 1.28 },
  { match: /rigid panel|board|wood|metal|relief/i, factor: 1.22 },
  { match: /stretched canvas/i, factor: 1.14 },
];

function sellerZoneFactor(pincode) {
  const first = String(pincode || '').trim()[0];
  if (!/^[1-9]$/.test(first || '')) return 1.1;
  if (['1', '2', '3'].includes(first)) return 1.0;
  if (['4', '5', '6'].includes(first)) return 1.06;
  if (['7', '8'].includes(first)) return 1.12;
  return 1.18;
}

export function calculatePartnerPackingCharge(artwork) {
  if (String(artwork?.packing_mode || 'self') !== 'partner') return 0;
  const length = Math.max(1, Number(artwork?.length_cm) || 30);
  const breadth = Math.max(1, Number(artwork?.breadth_cm) || 24);
  const depth = Math.max(1, Number(artwork?.height_cm) || 5);
  const volumeUnits = Math.max(1, Math.ceil((length * breadth * depth) / 5000));
  const format = `${artwork?.delivery_format || ''} ${artwork?.delivery_format_other || ''}`;
  const formatFactor = FORMAT_FACTORS.find((entry) => entry.match.test(format))?.factor || 1.2;
  const zoneFactor = sellerZoneFactor(artwork?.pickup_pincode);
  return roundUpRupee((125 + (volumeUnits * 95)) * formatFactor * zoneFactor);
}

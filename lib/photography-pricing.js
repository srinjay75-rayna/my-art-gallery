export const PHOTOGRAPHY_GRADES = [
  {
    grade: 1, key: 'grade_1', name: 'The Sovereign Unframed Rag', label: 'GRADE I', size: '12 × 18 Inches', edition: 30, multiplier: 1,
    substrate: '308 GSM Hahnemühle Photo Rag® (100% pure German cotton rag, matte velvet texture, 2-inch white museum border)',
    copy: 'Crafted for discerning private framers and global collectors. Printed in 12-color archival pigment inks on genuine 308 GSM German Hahnemühle cotton rag, delivering deep obsidian blacks, luminous tonal depth, and certified 100-year museum permanence.',
    packing: 'Protective archival flat-pack', package: { weight: 1, length_cm: 48, breadth_cm: 36, height_cm: 6 },
  },
  {
    grade: 2, key: 'grade_2', name: 'The Heritage Gallery Framed', label: 'GRADE II', size: '16 × 24 Inches', edition: 20, multiplier: 1.5,
    substrate: '308 GSM Hahnemühle Photo Rag® (2.5″ acid-free museum mat, solid matte-black hardwood frame, UV anti-reflective acrylic)',
    copy: 'Designed to command quiet luxury in contemporary residences and private studies. Every detail—from the pH-neutral bevel-cut conservation mat to optical-grade UV museum glazing—shields the work against light aging while arriving ready to hang.',
    packing: 'Museum-framed protective crate', package: { weight: 3, length_cm: 68, breadth_cm: 54, height_cm: 14 },
  },
  {
    grade: 3, key: 'grade_3', name: 'The Imperial Floating Canvas', label: 'GRADE III', size: '24 × 36 Inches', edition: 10, multiplier: 2.5,
    substrate: '400 GSM Hahnemühle Daguerre Canvas (Hand-applied dual satin UV varnish, 1.5″ kiln-dried stretcher bars, solid walnut shadow-gap frame)',
    copy: 'Where rich painterly texture meets architectural presence. Heavyweight 400 GSM German museum canvas is hand-varnished for a subtle, luminous gallery sheen and suspended inside a precision-milled solid walnut shadow gap.',
    packing: 'Reinforced gallery crate', package: { weight: 5, length_cm: 100, breadth_cm: 76, height_cm: 18 },
  },
  {
    grade: 4, key: 'grade_4', name: 'The Maharajah Sovereign Float', label: 'GRADE IV (FLAGSHIP)', size: '30 × 45 Inches', edition: 5, multiplier: 4,
    substrate: '310 GSM Hahnemühle German Etching® (3D raised float-mount over raw linen backing inside a deep Burma teak shadow-box with UV glazing)',
    copy: 'The pinnacle of the ARTISTE ™ collection. Monumental in scale and uncompromising in craft, mould-made German Etching rag is float-mounted in three-dimensional relief inside a deep hand-finished teak shadow box with white-glove crating.',
    packing: 'White-glove, air-crated dispatch', package: { weight: 9, length_cm: 126, breadth_cm: 96, height_cm: 28 },
  },
];

const LAB_DEFAULTS = [1400, 3200, 6800, 12500];
export function getPrintLabCosts() {
  // Static references are intentional: Next.js inlines NEXT_PUBLIC_* values
  // into browser bundles, so collector previews and server checkout use the
  // same environment-controlled production rates.
  const configured = [
    process.env.NEXT_PUBLIC_PRINT_GRADE_1_LAB_COST,
    process.env.NEXT_PUBLIC_PRINT_GRADE_2_LAB_COST,
    process.env.NEXT_PUBLIC_PRINT_GRADE_3_LAB_COST,
    process.env.NEXT_PUBLIC_PRINT_GRADE_4_LAB_COST,
  ];
  return configured.map((raw, index) => {
    const value = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(value) && value >= 0 ? value : LAB_DEFAULTS[index];
  });
}

export function calculatePhotographyGradePrices(gradeOneArtistFee, costs = getPrintLabCosts()) {
  const base = Number(gradeOneArtistFee);
  if (!Number.isFinite(base) || base <= 0) return [];
  return PHOTOGRAPHY_GRADES.map((grade, index) => {
    const artistFee = Math.round(base * grade.multiplier * 100) / 100;
    const labCost = Math.round(Number(costs[index] || 0) * 100) / 100;
    return { ...grade, artist_fee: artistFee, lab_cost: labCost, collector_price: Math.round((artistFee + labCost) * 100) / 100, edition_remaining: grade.edition };
  });
}

export function photographyGrade(value) {
  const grade = Number(value || 1);
  return PHOTOGRAPHY_GRADES.find((entry) => entry.grade === grade) || PHOTOGRAPHY_GRADES[0];
}

/** IMD / SKUAST-K agromet advisory links per Kashmir district (shown alongside the app's own engine). */
export const KASHMIR_DISTRICTS = ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Ganderbal', 'Kulgam', 'Kupwara', 'Pulwama', 'Shopian', 'Srinagar', 'Kargil', 'Leh'];

export function advisoryLinks(district: string) {
  const d = KASHMIR_DISTRICTS.find((x) => x.toLowerCase() === district.toLowerCase());
  return {
    district: d ?? district,
    known: !!d,
    links: [
      { label: 'IMD Meghdoot app (district & crop advisories)', url: 'https://play.google.com/store/apps/details?id=com.aas.meghdoot', deepLink: 'meghdoot://', kind: 'app' },
      { label: 'IMD–SKUAST-K joint agromet bulletin (Srinagar)', url: 'https://mausam.imd.gov.in/srinagar/mcdata/agromet.pdf', kind: 'pdf' },
      { label: 'IMD district rainfall forecast (J&K)', url: 'https://mausam.imd.gov.in/srinagar/mcdata/district_fc.pdf', kind: 'pdf' },
      { label: 'IMD Agromet Advisory Services (state)', url: 'https://mausam.imd.gov.in/responsive/agromet_adv_ser_state_current.php', kind: 'web' },
      { label: 'SKUAST-K advisories & GKMS bulletins', url: 'https://skuastkashmir.ac.in/', kind: 'web' },
      { label: 'J&K Horticulture — spray schedule', url: 'https://hortikashmir.jk.gov.in/', kind: 'web' },
    ],
    note: 'Official advisories take precedence over app model outputs.',
  };
}

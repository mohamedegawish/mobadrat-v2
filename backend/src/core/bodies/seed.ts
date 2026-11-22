/**
 * Demo directory of bodies (development / demo deployments only, with the rest of the demo seed): the real bodies behind
 * the demo organizations of each initiative. The two «إدارة النظام» organizations are left unlinked on purpose: the
 * directory then shows a link suggestion (same body in two initiatives).
 */
import { MODULES } from '../../initiatives/registry.js';
import { addLink, createBody, type BodyInput } from './store.js';

const DEMO: Array<BodyInput & { id: string; links: Array<[string, string]> }> = [
  { id: 'body-imc', nameAr: 'مركز تحديث الصناعة (IMC)', nameEn: 'Industrial Modernisation Centre (IMC)', kind: 'center', description: 'يراجع طلبات شمس الصناعة ويدير مبادرة صُنّاع المستقبل.',
    contactEmail: 'info@imc.example.gov.eg', contactPhone: '', website: '', links: [['shams', 'org-imc'], ['sona3', 'org-imc']] },
  { id: 'body-encpc', nameAr: 'المركز الوطني للإنتاج الأنظف (ENCPC)', nameEn: 'Egypt National Cleaner Production Centre (ENCPC)', kind: 'center', description: 'المراجعة الفنية في شمس الصناعة.',
    contactEmail: '', contactPhone: '', website: '', links: [['shams', 'org-encpc']] },
  { id: 'body-pmu', nameAr: 'وحدة إدارة مبادرة شمس الصناعة (PMU)', nameEn: 'Shams El-Senaa management unit (PMU)', kind: 'government', description: '',
    contactEmail: '', contactPhone: '', website: '', links: [['shams', 'org-pmu']] },
  { id: 'body-committee', nameAr: 'لجنة تقييم صُنّاع المستقبل', nameEn: 'Sona\'a El-Mostaqbal evaluation committee', kind: 'committee', description: '',
    contactEmail: '', contactPhone: '', website: '', links: [['sona3', 'org-committee']] },
  { id: 'body-bank-a', nameAr: 'بنك تجريبي (أ)', nameEn: 'Demo Bank A', kind: 'financial', description: '', contactEmail: '', contactPhone: '', website: '', links: [['shams', 'org-bank-demo-a']] },
  { id: 'body-bank-b', nameAr: 'بنك تجريبي (ب)', nameEn: 'Demo Bank B', kind: 'financial', description: '', contactEmail: '', contactPhone: '', website: '', links: [['shams', 'org-bank-demo-b']] },
  { id: 'body-funder-demo', nameAr: 'جهة تمويل تجريبية (صندوق تجريبي)', nameEn: 'Demo Funder', kind: 'financial', description: '', contactEmail: '', contactPhone: '', website: '', links: [['sona3', 'org-funder-demo-1']] },
];

export async function seedDemoBodies(): Promise<void> {
  const available = new Map<string, Set<string>>();
  for (const m of MODULES) available.set(m.id, new Set((await m.bodies.list()).map((o) => o.id)));
  for (const d of DEMO) {
    const links = d.links.filter(([initiativeId, orgId]) => available.get(initiativeId)?.has(orgId));
    if (!links.length) continue;
    const { id, links: _links, ...input } = d;
    await createBody(input, null, id);
    for (const [initiativeId, orgId] of links) await addLink(id, initiativeId, orgId, null);
  }
}

// Module shim: governorates and industrial zones are platform reference data (core/reference/locations.ts).
import { listGovernorates, type Governorate } from '../../../core/reference/locations.js';

export { findGovernorate, isValidZone, OTHER_ZONE, type Zone, type Governorate } from '../../../core/reference/locations.js';

/** The governorates list (live view of the platform's reference data). */
export const GOVERNORATES: Governorate[] = new Proxy([] as Governorate[], {
  get(_t, prop) {
    const list = listGovernorates();
    const v = Reflect.get(list, prop);
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(list) : v;
  },
});

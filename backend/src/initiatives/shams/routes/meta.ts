import { Router } from 'express';
import { ah, okMessage } from '../http/errors.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { listGovernorates } from '../config/locations.js';
import { FORM_FIELDS, FORM_SECTIONS, DOCUMENT_LABELS, DOCUMENT_KINDS } from '../workflow/applicationForm.js';
import {
  APPLICATION_STATES, STATE_LABELS, STATE_RESPONSIBLE, STATE_STEP, RESPONSIBLE_LABELS, TERMINAL_STATES, TRANSITIONS,
} from '../workflow/shamsWorkflow.js';
import { listActiveBanks } from '../store/organizations.js';
import { ROLE_LABELS } from '../domain.js';
import { config } from '../config.js';
import { slaConfigured } from '../workflow/applicationView.js';

export const metaRouter = Router();

/** تعريف الفورم والحالات والقيم المرجعية — مصدر واحد للواجهة (الإجبارية والتسميات من الباك). */
metaRouter.get('/meta', ah(async (_req, res) => okMessage(res, 200, 'ok', {
  form: {
    sections: FORM_SECTIONS,
    fields: FORM_FIELDS.map((f) => ({ ...f, required: shamsPolicy.requiredFields[f.key] })),
    maxFileSizeMB: shamsPolicy.maxFileSizeMB,
    electricityBills: shamsPolicy.electricityBills,
    roofAreas: shamsPolicy.roofAreas,
    capacityUnits: shamsPolicy.capacityUnits,
    loadUnits: shamsPolicy.loadUnits,
    ownershipTypes: shamsPolicy.ownershipTypes,
  },
  governorates: listGovernorates(),
  documents: DOCUMENT_KINDS.map((k) => ({ kind: k, labelAr: DOCUMENT_LABELS[k].ar, labelEn: DOCUMENT_LABELS[k].en })),
  states: APPLICATION_STATES.map((s) => ({
    state: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en, step: STATE_STEP[s], terminal: TERMINAL_STATES.includes(s),
    responsible: STATE_RESPONSIBLE[s], responsibleLabelAr: RESPONSIBLE_LABELS[STATE_RESPONSIBLE[s]].ar, responsibleLabelEn: RESPONSIBLE_LABELS[STATE_RESPONSIBLE[s]].en,
  })),
  transitions: TRANSITIONS.map((t) => ({ step: t.step, from: t.from, action: t.action, actorRole: t.actorRole, to: t.to, when: t.when ?? null, proposed: Boolean(t.proposed), labelAr: t.labelAr, labelEn: t.labelEn })),
  roles: ROLE_LABELS,
  banks: await listActiveBanks(),
  policy: {
    maxReturnsPerStage: shamsPolicy.maxReturnsPerStage,
    withdrawFrom: shamsPolicy.withdrawFrom,
    bankSelection: shamsPolicy.bankSelection,
    slaDays: shamsPolicy.slaDays,
    slaPhases: shamsPolicy.slaPhases,
    slaConfigured: slaConfigured(),
    contractAmountAlertEGP: shamsPolicy.contractAmountAlertEGP,
    imcRejectReasonCodes: shamsPolicy.imcRejectReasonCodes,
    adminCanViewApplicationDocuments: shamsPolicy.adminCanViewApplicationDocuments,
  },
  /** I9: قناة الاستفسار الرسمية — null عند عدم الضبط (لا تُعرض). */
  support: { email: config.supportEmail || null, phone: config.supportPhone || null },
})));

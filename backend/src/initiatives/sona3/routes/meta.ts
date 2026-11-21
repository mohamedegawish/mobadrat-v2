import { Router } from 'express';
import { ah, okMessage } from '../http/errors.js';
import { policy, CRITERIA } from '../config/initiativePolicy.js';
import { GOVERNORATES } from '../config/locations.js';
import { FORM_FIELDS, FORM_SECTIONS, SECTION_LABELS, DOCUMENT_LABELS, DOCUMENT_KINDS, formOfSection } from '../workflow/applicationForm.js';
import {
  APPLICATION_STATES, STATE_LABELS, STATE_RESPONSIBLE, STATE_STEP, STATE_TASKS, JOURNEY_STEPS, RESPONSIBLE_LABELS, TERMINAL_STATES, TRANSITIONS,
  APPEALABLE_STATES,
} from '../workflow/workflow.js';
import { listActiveFunders } from '../store/organizations.js';
import { listExperts } from '../store/experts.js';
import { openCohort, cohortStatus } from '../store/cohorts.js';
import { ROLE_LABELS } from '../domain.js';
import { config } from '../config.js';
import { slaConfigured } from '../workflow/applicationView.js';

export const metaRouter = Router();

/** تعريف الفورم والحالات والقيم المرجعية — مصدر واحد للواجهة (الإجبارية والتسميات من الباك). */
metaRouter.get('/meta', ah((_req, res) => {
  const cohort = openCohort();
  return okMessage(res, 200, 'ok', {
    initiative: policy.content,
    form: {
      sections: FORM_SECTIONS.map((s) => ({ key: s, form: formOfSection(s), labelAr: SECTION_LABELS[s].ar, labelEn: SECTION_LABELS[s].en })),
      fields: FORM_FIELDS,
      maxFileSizeMB: policy.maxFileSizeMB,
      limits: { teamMaxPartners: policy.team.maxPartners, ideaMaxWords: policy.idea.maxWords, files: policy.files, study: policy.study },
    },
    options: {
      governorates: GOVERNORATES.map((g) => ({ value: g.value, labelAr: g.labelAr, labelEn: g.labelEn })),
      nationalities: policy.nationalities,
      applicationTypes: policy.applicationTypes,
      sectors: policy.sectors,
      projectStages: policy.projectStages,
      startTimelines: policy.startTimelines,
      technologyLevels: policy.technologyLevels,
      materialSources: policy.materialSources,
      financingModels: policy.financingModels,
      recommendations: policy.recommendations,
      experts: listExperts({ status: 'approved' }).map((e) => ({ value: e.id, labelAr: e.nameAr, labelEn: e.nameEn || e.nameAr, specialty: e.specialty })),
    },
    governorates: GOVERNORATES,
    documents: DOCUMENT_KINDS.map((k) => ({ kind: k, labelAr: DOCUMENT_LABELS[k].ar, labelEn: DOCUMENT_LABELS[k].en })),
    criteria: CRITERIA,
    defaultWeights: policy.defaultWeights,
    journey: JOURNEY_STEPS,
    states: APPLICATION_STATES.map((s) => ({
      state: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en, step: STATE_STEP[s], terminal: TERMINAL_STATES.includes(s),
      taskAr: STATE_TASKS[s]?.ar ?? null, taskEn: STATE_TASKS[s]?.en ?? null,
      responsible: STATE_RESPONSIBLE[s], responsibleLabelAr: RESPONSIBLE_LABELS[STATE_RESPONSIBLE[s]].ar, responsibleLabelEn: RESPONSIBLE_LABELS[STATE_RESPONSIBLE[s]].en,
    })),
    transitions: TRANSITIONS.map((t) => ({ ...t })),
    roles: ROLE_LABELS,
    funders: listActiveFunders(),
    openCohort: cohort ? { id: cohort.id, nameAr: cohort.nameAr, nameEn: cohort.nameEn, opensAt: cohort.opensAt, closesAt: cohort.closesAt, status: cohortStatus(cohort), maxAge: cohort.maxAge } : null,
    policy: {
      appealWindowDays: policy.appealWindowDays,
      appealableStates: APPEALABLE_STATES,
      withdrawBefore: policy.withdrawBefore,
      slaDays: policy.slaDays,
      slaConfigured: slaConfigured(),
      adminCanViewApplicationDocuments: policy.adminCanViewApplicationDocuments,
      maskNationalIdForExternal: policy.maskNationalIdForExternal,
      applicantSeesScoreAfterSelection: policy.applicantSeesScoreAfterSelection,
      requireReasonForOutOfRankSelection: policy.requireReasonForOutOfRankSelection,
      allowReapplyAfterTerminal: policy.allowReapplyAfterTerminal,
    },
    /** قناة الاستفسار الرسمية — null عند عدم الضبط (لا تُعرض). */
    support: { email: config.supportEmail || null, phone: config.supportPhone || null },
  });
}));

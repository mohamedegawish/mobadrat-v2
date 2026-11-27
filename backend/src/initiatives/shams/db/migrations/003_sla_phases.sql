-- D12: the offer deadline is shared by the offer states and counted from ENCPC's technical acceptance, so the start of the
-- current SLA phase is stored next to stateEnteredAt.
ALTER TABLE shams_applications ADD COLUMN slaStartedAt VARCHAR(32) NULL;

UPDATE shams_applications SET slaStartedAt = stateEnteredAt;

UPDATE shams_applications a
SET a.slaStartedAt = COALESCE(
  (SELECT MAX(t.createdAt) FROM shams_application_transitions t WHERE t.applicationId = a.id AND t.action = 'compliant'),
  a.stateEnteredAt)
WHERE a.state IN ('OFFER_UPLOAD','OFFER_REVIEW','OFFER_CORRECTION');

-- Owner changes 2026-11-27 (D13-D18): the Ministry of Electricity organisation and role, the proof document the factory
-- sends after a technical or electricity rejection, and the two retired factory steps (provider selection, electricity upload).
ALTER TABLE shams_organizations DROP CHECK shams_organizations_chk_1;
ALTER TABLE shams_organizations
  ADD CONSTRAINT ck_shams_org_type CHECK (type IN ('factory','imc','encpc','pmu','electricity','bank','admin'));

ALTER TABLE shams_account_requests DROP CHECK shams_account_requests_chk_2;
ALTER TABLE shams_account_requests
  ADD CONSTRAINT ck_shams_account_role CHECK (role IN ('imc_reviewer','encpc_reviewer','pmu_reviewer','electricity_reviewer','bank_reviewer'));

ALTER TABLE shams_documents DROP CHECK chk_shams_docs_kind;
ALTER TABLE shams_documents
  ADD CONSTRAINT chk_shams_docs_kind CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile','distributionApprovalFile','correctionProofFile'));

INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES
  ('org-electricity', 'electricity', 'وزارة الكهرباء والطاقة المتجددة', 'Ministry of Electricity and Renewable Energy',
   CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'));

DROP TRIGGER shams_membership_role_org;

DELIMITER //
CREATE TRIGGER shams_membership_role_org BEFORE INSERT ON initiative_memberships FOR EACH ROW
BEGIN
  IF NEW.initiativeId = 'shams' AND NOT EXISTS (
    SELECT 1 FROM shams_organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'factory_owner' THEN 'factory' WHEN 'imc_reviewer' THEN 'imc' WHEN 'encpc_reviewer' THEN 'encpc'
      WHEN 'pmu_reviewer' THEN 'pmu' WHEN 'electricity_reviewer' THEN 'electricity' WHEN 'bank_reviewer' THEN 'bank'
      WHEN 'system_admin' THEN 'admin' END) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'role does not match organization type';
  END IF;
END//
DELIMITER ;

-- D14: provider selection is retired. Applications waiting there move to the offer upload; their offer deadline starts now.
INSERT INTO shams_application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, createdAt)
SELECT CONCAT('trn-m004p-', MD5(a.id)), a.id, 'PROVIDER_SELECTION', 'OFFER_UPLOAD', 'provider_selection_retired', 'system', a.attempt,
  CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
FROM shams_applications a WHERE a.state = 'PROVIDER_SELECTION';

UPDATE shams_applications SET state = 'OFFER_UPLOAD', version = version + 1,
  stateEnteredAt = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'),
  slaStartedAt = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
WHERE state = 'PROVIDER_SELECTION';

-- D18: the factory no longer uploads the electricity approval, the ministry does. Applications waiting for that upload go to
-- the ministry. Applications already under review stay there; the file the factory uploaded counts as the approval file.
INSERT INTO shams_application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, createdAt)
SELECT CONCAT('trn-m004e-', MD5(a.id)), a.id, 'ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW', 'electricity_upload_retired', 'system', a.attempt,
  CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
FROM shams_applications a WHERE a.state = 'ELECTRICITY_UPLOAD';

UPDATE shams_applications SET state = 'ELECTRICITY_REVIEW', version = version + 1,
  stateEnteredAt = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'),
  slaStartedAt = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
WHERE state = 'ELECTRICITY_UPLOAD';

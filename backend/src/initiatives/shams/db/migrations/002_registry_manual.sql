-- Manual verification of the industrial registry (REGISTRY_ADAPTER=manual). Until the registry API is connected, the factory
-- uploads its industrial registry certificate (industrialRegisterFile, a required document) and IMC checks the number against
-- it during the review; the check is recorded honestly as 'manual' (never as 'valid'), with the adapter that produced it.
ALTER TABLE shams_registry_verifications DROP CHECK shams_registry_verifications_chk_1, DROP CHECK shams_registry_verifications_chk_2;
ALTER TABLE shams_registry_verifications
  ADD CONSTRAINT ck_shams_registry_result CHECK (result IN ('valid','invalid','unavailable','manual')),
  ADD CONSTRAINT ck_shams_registry_adapter CHECK (adapter IN ('mock','http','manual'));

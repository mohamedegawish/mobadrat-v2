-- The initiative page design of the public site (the original platform's «تخصيص المبادرة»): which sections the page shows
-- and in what order, the hero layout and texts, the gallery, and whether the instant eligibility check is offered.
-- A JSON object; {} = the page's default design.

ALTER TABLE initiatives ADD COLUMN customization MEDIUMTEXT NOT NULL DEFAULT ('{}') AFTER financialTerms;

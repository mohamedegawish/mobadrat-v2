-- The initiative's published figures changed on 2026-11-24: 500 projects evaluated, 300 selected, applicants aged up to 40
-- (the public content and the defaults of new cohorts changed with them). Cohorts that still carry the old built-in values
-- (60 evaluated, 15 selected, age 35) take the new ones; a value an administrator set differently stays as it is.
UPDATE sona3_cohorts SET maxAge = 40 WHERE maxAge = 35;
UPDATE sona3_cohorts SET evaluationTarget = 500, selectionTarget = 300 WHERE evaluationTarget = 60 AND selectionTarget = 15;

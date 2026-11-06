Synthetic demo data for the AI Daily Site Report (no real customer data).

- `notes.txt`: supervisor notes typed into the report.
- `draft.json`: the draft a correct extraction of those notes gives. It is
  used by the fake AI provider for local demos
  (`DAILY_REPORT_AI_FAKE_DRAFT_FILE`) and by the regression tests.

It records only what the notes state: the pump delay has cause "other" (the
notes say it was late, not that it broke down), weather conditions are empty
(the notes give neither cloud cover nor rain intensity), and there is no
delivery (pouring 43 m³ is work done, not a recorded delivery).

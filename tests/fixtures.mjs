export const SAMPLE = `#+TITLE: Work

* NEXT [#A] Ship quarterly report :work:urgent:
  DEADLINE: <2026-07-22 Wed>
  :PROPERTIES:
  :Effort:   3h
  :ADDED:    [2026-07-18 Sat]
  :END:
  Notes about the task.
  [[file:images/mockup.png]]
* TODO Plain task
* DONE [#C] Old thing :misc:
  CLOSED: [2026-07-10 Fri 09:15]
** Sub-heading stays in body
   body of sub
`;

export const NESTED = `#+TITLE: Nested

* NEXT [#A] Ship quarterly report :work:
  DEADLINE: <2026-07-22 Wed>
  :PROPERTIES:
  :Effort:   3h
  :END:
  Parent notes.
** TODO [#B] Draft outline :writing:
   DEADLINE: <2026-07-19 Sun>
   :PROPERTIES:
   :ADDED:    [2026-07-18 Sat]
   :Effort:   1h
   :END:
   Sub notes.
** DONE Collect figures
   CLOSED: [2026-07-17 Fri 10:00]
*** Deep heading stays verbatim
    deep body
* TODO Plain task
`;

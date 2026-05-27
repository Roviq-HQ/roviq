# Timetable -- Help Guide

The **Timetable** module lets your institute build and manage weekly class schedules. A timetable belongs to one academic year, covers a chosen set of sections, has a grid of periods (with lunch breaks and optional extra classes), and assigns a **subject, teacher, and room** to each period on each working day.

This guide is part of the [Institute Portal User Guide](./institute-workflows.md).

Find it in the sidebar under **Academic > Timetable**.

---

## Table of Contents

1. [Who can do what](#who-can-do-what)
2. [Before you start](#before-you-start)
3. [Key terms](#key-terms)
4. [Viewing your timetables](#viewing-your-timetables)
5. [Creating a timetable](#creating-a-timetable)
6. [Editing the grid (assigning classes)](#editing-the-grid-assigning-classes)
7. [Activating, deactivating, archiving](#activating-deactivating-archiving)
8. [Viewing a section's timetable (print / PDF)](#viewing-a-sections-timetable-print--pdf)
9. [Viewing a staff member's timetable](#viewing-a-staff-members-timetable)
10. [Day schedule and one-off changes (overrides)](#day-schedule-and-one-off-changes-overrides)
11. [Taking attendance from a period](#taking-attendance-from-a-period)
12. [Where timetables appear across the app](#where-timetables-appear-across-the-app)
13. [Frequently asked questions](#frequently-asked-questions)

---

## Who can do what

| Action | Who can do it |
|--------|---------------|
| Create, edit, activate, delete timetables | **Institute Admin, Principal, Vice Principal, Academic Coordinator** |
| View timetables (read-only) | **Teachers, students, parents** (and all of the above) |

If you do not have permission, the page shows an "Access denied" message.

---

## Before you start

Choose the **academic year** at the top-right of the page first. Every timetable belongs to one academic year, and the list only shows timetables for the selected year.

---

## Key terms

- **Timetable** -- a weekly schedule template for one academic year, covering a set of sections.
- **Period** -- a time slot in the day. Periods can be a normal class (**Period**), a **Break** (e.g. lunch), or an **Extra** class (morning/evening).
- **Working days** -- the days the timetable runs (Monday-Saturday by default; Sunday can be enabled).
- **Status** -- a timetable is **Draft**, **Active**, **Inactive**, or **Archived**. Only one timetable can be **Active** per academic year.
- **Override** -- a one-off change for a single date (for example, a substitute teacher), without changing the weekly template.

---

## Viewing your timetables

The main page lists every timetable for the selected academic year, showing its **status**, effective dates, and number of working days.

- Use the **search** box to find a timetable by name.
- Use the **status** filter to show only Draft / Active / Inactive / Archived.
- Click a row to open the **editor**. Row actions let you activate or deactivate, edit, or delete a timetable.

---

## Creating a timetable

1. Click **Create**. A full-screen dialog opens.
2. Fill in the details:
   - **Name** (for example, "Summer 2026") -- required.
   - **Effective from / to** -- the date range this timetable is in effect.
   - **Sections** -- use the section picker to choose which classes this timetable covers. You can select individual sections, a whole department, a whole class, or everything at once with **Select all**.
   - **Schedule** -- day start time, period duration, number of periods per day, and working days. Optionally add **lunch breaks** (placed after a chosen period) and **extra classes** (morning or evening).
3. Click **Create**.

The period grid is generated automatically from your schedule settings, and the new timetable starts in **Draft**.

---

## Editing the grid (assigning classes)

1. Open a timetable to reach the **editor**.
2. Use the **section tabs** to choose which section's grid you are editing.
3. Click any empty period cell to open the **assign** dialog:
   - Choose the **subject**, **teacher**, and **room**.
   - Choose which **weekdays** this assignment repeats on, so you can fill a whole row in one step.
   - Use **splits** when two groups share the same period (for example, an elective split).
4. Click **Save**.

> **Note:** If the teacher or room you pick is already booked for that period on that day, the system blocks the clash and shows a clear error. This prevents double-booking a teacher.

You can also **add a period / break / extra class** or **remove a period** using the toolbar buttons.

---

## Activating, deactivating, archiving

Use the buttons in the editor header:

- **Activate** -- makes this the live timetable. Only **one timetable can be active per academic year** -- activating a new one automatically deactivates the previous active timetable.
- **Deactivate** -- takes an active timetable offline (back to Inactive).
- **Archive** -- retires a timetable. Archived timetables are read-only and can no longer be edited or activated.

---

## Viewing a section's timetable (print / PDF)

Open **Timetable > Section view** (or use the **View timetable** link on a section's detail page).

1. Pick a **standard**, then a **section**.
2. The weekly grid for that section's active timetable appears.
3. Click **Download PDF** to save a printable PDF, or **Print** to print directly from your browser.

---

## Viewing a staff member's timetable

Open **Timetable > Staff view** (or use the **View timetable** link on a staff member's detail page).

1. By default it shows **your own** weekly schedule ("Me"). Pick another **teacher** from the dropdown to view theirs.
2. Use **Download PDF** or **Print** just like the section view.

---

## Day schedule and one-off changes (overrides)

The **Day schedule** page shows the classes for a single date and section, with any one-off changes applied.

1. Pick a **date** and a **standard + section**.
2. Each period row shows the subject, teacher, and room for that day.
3. To make a one-off change, click **Override** on a period and choose the type:
   - **Substitution** -- a different teacher takes the class.
   - **Cancellation** -- the class is cancelled that day.
   - **Room change** / **Subject change**.
   - **Extra** -- an additional class.
4. Overrides apply **only to the chosen date** -- the weekly template stays unchanged. You can clear an override anytime from the **Manage overrides** list.

---

## Taking attendance from a period

On the **Day schedule** page, each teaching period has a **Take attendance** link. Clicking it opens the Attendance page already set to that date, class, section, and period -- so you can mark attendance for exactly that lecture without re-selecting anything.

---

## Where timetables appear across the app

- **Dashboard** -- if you are a teacher with classes today, a **Today's classes** card shows your schedule for the day, with a link to your full timetable.
- **Academics > standard detail** -- each section row has a **View timetable** link.
- **People > staff detail** -- a **View timetable** link to that teacher's schedule.
- **People > student detail** -- a **View timetable** link to the student's class schedule (visible to the student and their parents).

---

## Frequently asked questions

**Why can't I activate a timetable?**
Only one timetable can be active per academic year. Activating a new one automatically deactivates the current active one -- you do not need to deactivate it first. Archived timetables cannot be activated.

**Why does the section view say "No active timetable"?**
The section's timetable has not been activated yet, or no active timetable covers that section. Open the timetable and click **Activate**, and make sure the section is included in its coverage.

**I assigned a teacher but got an error.**
That teacher (or room) is already booked for the same period on the same day in this timetable. Pick a different teacher/room, or change the other assignment first.

**Can parents and students see the timetable?**
Yes. Students and parents have read-only access and can view the relevant section timetable (for example, from the student's detail page).

**Will editing the weekly timetable change past days?**
The weekly template defines the recurring schedule. One-off changes for specific dates are handled with **overrides** on the Day schedule page, which never modify the template.

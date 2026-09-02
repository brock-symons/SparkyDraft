# SPARKY DRAFT — FULL APPLICATION UX/UI REDESIGN & CAD WORKSPACE DIRECTIVE

> Filed verbatim as given by the project owner, so it persists independently
> of any chat transcript. See [CLAUDE.md](CLAUDE.md)'s "`app/` — the React
> CAD workspace redesign" section for how this directive's sections map to
> actual decisions and files in `app/`.

The smaller/older version redesign you have just completed is now a DESIGN REFERENCE and UX EXPERIMENT.

It is NOT the final application.

The next task is to take what you learned from that redesign and apply it intelligently to the ENTIRE CURRENT SparkyDraft application/codebase.

The active GitHub repository is:

https://github.com/brock-symons/SparkyDraft

The current application is an electrical drafting/productivity application covering workflows such as switchboard and floor-plan drafting, elevations, grid layouts, quotes, circuit/comms rack assignment, projects and organisation collaboration.

The goal is NOT simply to make the existing application "look modern."

The goal is to create the UX foundation of a professional electrical drafting tool that happens to run on the web.

---

## 1. FIRST PRINCIPLE

Design SparkyDraft as:

Professional drafting software + modern web application + electrical industry workflow tool

NOT:

Generic SaaS dashboard + drawing canvas

The canvas/workspace should be the centre of the experience.

The surrounding UI should exist primarily to help the user:

CREATE → EDIT → INSPECT → DOCUMENT → QUOTE → REVIEW → COLLABORATE → EXPORT

with as little unnecessary interruption as possible.

---

## 2. STUDY THE RIGHT PRODUCTS

Before finalising the design, analyse the interaction philosophies of relevant professional software.

Study tools such as:

* AutoCAD
* Autodesk Fusion
* SolidWorks
* Onshape
* SketchUp
* Figma

But ALSO think specifically about electrical/design/construction workflows.

Look at how professional users deal with:

* symbols
* components
* layers
* measurements
* annotations
* snapping
* alignment
* grids
* properties
* object libraries
* plans
* schematics
* documentation
* revisions
* project organisation
* collaboration
* exporting
* printing

Do NOT copy their visual appearance.

Extract the interaction principles that make professional drafting software efficient.

---

## 3. THE CANVAS IS THE PRODUCT

The drafting workspace should receive the strongest design attention.

Avoid making SparkyDraft feel like:

Sidebar → Dashboard → Cards → Canvas

Instead think:

Application chrome
↓
Tools / contextual controls
↓
Large drafting workspace
↓
Properties / information when required

The user should feel like they are working ON a drawing, not navigating a website.

Maximise useful canvas space.

Panels should be:

* collapsible
* resizable where appropriate
* contextual where appropriate
* dismissible
* intelligently remembered

Do not permanently consume valuable workspace unless there is a strong reason.

---

## 4. ELECTRICAL-DRAFTING-FIRST UX

Think carefully about what makes SparkyDraft different from generic CAD.

The UI should eventually support the mental model of an electrician/electrical designer.

Consider the relationships between:

* projects
* switchboards
* circuits
* breakers
* loads
* rooms
* floor plans
* elevations
* equipment
* communications
* racks
* components
* symbols
* annotations
* quotes
* documentation

The interface should make these relationships understandable rather than forcing the user to manually manage disconnected pieces of information.

Where appropriate, investigate whether information can be represented visually AND structurally.

For example:

A component on a drawing may have:

* a visual representation
* a type
* a circuit
* a label
* properties
* a location
* associated documentation

The UI should make this relationship feel natural.

---

## 5. CONTEXTUAL UI

This is a major priority.

Do not expose every possible control at all times.

The interface should respond to what the user is doing.

Examples:

NOTHING SELECTED:
→ workspace/drawing controls

OBJECT SELECTED:
→ object properties and relevant actions

MULTIPLE OBJECTS SELECTED:
→ alignment, grouping, duplication, deletion, etc.

DRAWING:
→ drawing-specific controls

MEASURING:
→ measurement controls

SWITCHBOARD COMPONENT SELECTED:
→ electrical/component-specific properties

FLOOR PLAN OBJECT SELECTED:
→ location/drawing properties

This should significantly reduce visual clutter.

---

## 6. PRECISION WITHOUT COMPLEXITY

SparkyDraft needs to feel precise without overwhelming users.

Support intuitive direct manipulation while allowing exact numerical input.

For example:

Drag an object naturally.

Then allow:

Width: ___
Height: ___
X: ___
Y: ___
Rotation: ___

Where relevant.

Investigate:

* snapping
* alignment guides
* grid snapping
* object snapping
* measurement feedback
* constrained movement
* exact numerical positioning
* keyboard modifiers

Precision should be available when needed, not forced on the user constantly.

---

## 7. SNAPPING & VISUAL FEEDBACK

If an object snaps:

MAKE IT OBVIOUS.

Users should understand:

* what they snapped to
* why it snapped
* what alignment is occurring
* whether snapping is enabled

Use subtle visual indicators.

Do not rely purely on invisible logic.

---

## 8. SELECTION MUST BE EXCELLENT

Selection is fundamental to a drafting application.

Audit and improve:

* hover states
* selection states
* multi-selection
* selection boxes
* handles
* anchor points
* resize controls
* rotation
* snapping indicators
* locked objects
* hidden objects
* active objects
* object hierarchy

At every point, the user should understand:

"What does SparkyDraft currently think I have selected?"

---

## 9. COMMAND PALETTE

Investigate implementing a command/search system such as:

Ctrl/Cmd + K

Search:

Draw line
Add component
Measure
Duplicate
Align
Create switchboard
Export
Toggle grid
Toggle snapping
Zoom to selection

This becomes increasingly valuable as SparkyDraft grows.

Do not necessarily implement every possible command immediately.

Establish the architecture so commands can be added later.

---

## 10. KEYBOARD-FIRST POWER USER EXPERIENCE

Investigate a proper shortcut system.

Important fundamentals include:

* Undo
* Redo
* Delete
* Escape
* Enter
* Copy
* Paste
* Duplicate
* Save
* Zoom
* Pan
* Tool activation
* Multi-select
* Constrained movement

Show shortcuts inside menus/tooltips so users can discover them.

Do not make the application dependent on shortcuts.

They should accelerate experienced users.

---

## 11. MOBILE-FIRST DOES NOT MEAN "DESKTOP SHRUNK DOWN"

The existing SparkyDraft direction is mobile-first.

Take this seriously.

Design separate interaction strategies for:

Desktop

Maximum drafting workspace with persistent/contextual tools and properties.

Tablet

Reduced chrome with collapsible/contextual controls.

Mobile

Canvas-first interaction with accessible contextual controls, bottom sheets/tool palettes and touch-friendly controls.

Do NOT simply shrink desktop sidebars until everything becomes unusable.

The interaction model itself should adapt.

---

## 12. TOUCH INTERACTION

Because this is mobile-first, explicitly test:

* touch targets
* dragging
* pinch zoom
* pan
* selection
* multi-selection
* contextual menus
* bottom sheets
* keyboard/input behaviour
* accidental selections
* accidental canvas movement

Touch interaction should feel intentional.

---

## 13. WORKSPACE MODES

Investigate whether SparkyDraft benefits from clearly defined workspace modes.

For example, conceptually:

Draft
→ create/edit drawings

Inspect
→ examine properties and relationships

Quote
→ pricing/material workflow

Document
→ prepare outputs

Review
→ inspect/revise work

Do not automatically add these as separate features.

Determine whether the current product architecture benefits from this mental model.

If it does, design it elegantly.

---

## 14. OBJECT / COMPONENT LIBRARY

Investigate the best UX for reusable electrical objects/components.

The library should eventually feel like:

Search
↓
Find component
↓
Preview
↓
Place
↓
Configure
↓
Continue working

Rather than:

Open menu → find obscure option → configure modal → return to drawing.

Consider:

* categories
* search
* favourites
* recently used
* commonly used components
* custom components
* component metadata

Do not invent unnecessary component categories.

Base recommendations on the actual current application.

---

## 15. PROPERTIES / INSPECTOR

Create a strong inspector/property system where appropriate.

A selected object should expose the information relevant to that object.

For example:

GENERAL
Name
Type
Position
Size
Rotation

ELECTRICAL
Circuit
Rating
Phase
Load
Board
etc.

Do not show irrelevant properties.

Use progressive disclosure.

---

## 16. INFORMATION HIERARCHY

The user should immediately understand:

1. Where am I?
2. What project am I working on?
3. What drawing/workspace am I in?
4. What tool am I using?
5. What object is selected?
6. What can I do next?
7. What has changed?
8. Is my work saved?

The interface should answer these questions without unnecessary UI.

---

## 17. AUTOSAVE & DOCUMENT STATE

Investigate excellent feedback for:

* saving
* autosaving
* syncing
* offline state
* errors
* conflicts
* unsaved changes

The user should NEVER wonder:

"Did that save?"

Do not add fake save indicators.

Connect the UI to actual application state.

---

## 18. UNDO / REDO

Treat undo/redo as a CORE SYSTEM.

Audit the current implementation.

Every meaningful drafting operation should eventually have predictable undo/redo behaviour.

Test it extensively.

Undo should be trustworthy.

---

## 19. PROJECT / ORGANISATION UX

SparkyDraft is not only a drawing canvas.

There is a broader project/organisation system.

The design should make the transition between:

Organisation
→ Projects
→ Drawings
→ Workspaces
→ Outputs

feel natural.

Avoid turning the project management side into an unrelated SaaS dashboard.

The entire application should feel like one coherent product.

---

## 20. QUOTING SHOULD FEEL CONNECTED TO DRAFTING

Investigate whether information created during drafting can naturally support quoting.

The user shouldn't feel like:

"I finished drafting. Now I have to manually recreate everything for the quote."

Look for opportunities where the same underlying information can support:

* quantities
* components
* materials
* labour inputs
* documentation

Do NOT implement major quoting/business-logic changes without approval.

Identify opportunities and recommend them.

---

## 21. COLLABORATION

Because projects can be shared between organisation members, investigate UX patterns for:

* project ownership
* collaborators
* permissions
* invitations
* activity
* revisions
* comments/notes if relevant
* conflicts
* shared project state

Do not turn SparkyDraft into a social network.

Collaboration should support getting electrical work completed.

---

## 22. RESPONSIVE INFORMATION DENSITY

A professional tool needs to display a lot of information without becoming visually overwhelming.

Use:

* hierarchy
* grouping
* progressive disclosure
* contextual controls
* tooltips
* compact controls where appropriate
* expandable sections

Avoid huge cards and excessive whitespace inside the actual drafting workspace.

Modern does NOT necessarily mean enormous buttons and empty space.

---

## 23. VISUAL DESIGN

Use React + Tailwind CSS.

Establish a proper design system.

Define consistent:

* typography
* spacing
* borders
* radii
* shadows
* icons
* buttons
* inputs
* panels
* menus
* dialogs
* tooltips
* states
* colours
* elevation

The application should feel premium but restrained.

Avoid:

* excessive gradients
* excessive glassmorphism
* unnecessary cards
* excessive rounded containers
* giant headings
* decorative animations
* "AI startup dashboard" aesthetics

This is professional software.

It should feel confident and purposeful.

---

## 24. ANIMATION

Use subtle animation only where it improves understanding.

Good:

* panel transitions
* contextual controls
* selection feedback
* modal transitions
* state changes
* tool activation

Avoid:

* unnecessary page transitions
* bouncing
* excessive scaling
* decorative motion
* anything that slows down drafting

PERCEIVED PERFORMANCE IS MORE IMPORTANT THAN VISUAL EFFECTS.

---

## 25. ACCESSIBILITY

Audit:

* keyboard navigation
* focus states
* contrast
* labels
* tooltips
* screen-reader semantics where relevant
* touch target sizes
* reduced-motion preferences

Accessibility should not make the application feel worse.

It should make the application more robust.

---

## 26. EMPTY / LOADING / ERROR STATES

Every major part of the application should have intentional states.

Do not leave:

* blank screens
* unexplained spinners
* broken layouts
* generic errors

Design meaningful:

EMPTY
LOADING
ERROR
SUCCESS
SAVED
SYNCING
OFFLINE

states.

---

## 27. PERFORMANCE

Because the application is becoming substantially more sophisticated, do not sacrifice performance for appearance.

Pay particular attention to:

* canvas rendering
* large drawings
* many objects
* drag interactions
* selection
* zooming
* panning
* React re-renders
* state updates
* Supabase requests
* mobile performance

The application should feel responsive while manipulating objects.

---

## 28. FUTURE-PROOF THE DESIGN

Do not design only for the current number of tools/features.

Ask:

"If SparkyDraft becomes 5–10x larger, does this UI still work?"

The architecture should support future:

* tools
* components
* electrical symbols
* drawing types
* project types
* integrations
* exports
* AI-assisted workflows
* collaboration features

without requiring a complete redesign.

---

## 29. DESIGN FOR FLOW STATE

This is one of the most important requirements.

For every workflow ask:

How many unnecessary clicks does the user need to perform?

How often do they have to leave the canvas?

How often do they have to search for something they should have access to contextually?

Can the next action be predicted?

Can the application remember the user's working context?

Optimise for:

THINK
→ ACT
→ SEE RESULT
→ ADJUST
→ CONTINUE

not:

CLICK
→ MENU
→ SEARCH
→ MODAL
→ CONFIGURE
→ CLOSE
→ RETURN
→ CONTINUE

---

## 30. DO NOT TURN IT INTO A GENERIC CAD CLONE

This is extremely important.

SparkyDraft should NOT become:

"AutoCAD but with a different logo."

It should become:

The easiest professional electrical drafting workflow for the web.

Its unique advantage should eventually come from connecting drafting with the surrounding electrical workflow.

Keep that product identity.

---

## 31. WHAT YOU MAY CHANGE

You may independently implement:

* visual improvements
* responsive improvements
* accessibility improvements
* component consistency
* interaction improvements
* contextual UI
* better loading/empty/error states
* low-risk performance improvements
* low-risk UX improvements
* reusable design-system improvements
* low-risk bugs discovered during the redesign

provided they do not change the fundamental product behaviour.

---

## 32. WHAT YOU MUST NOT CHANGE WITHOUT MY APPROVAL

Do NOT independently:

* remove major features
* change core business logic
* redesign the underlying data model
* change database architecture
* change pricing
* remove workflows
* fundamentally change navigation
* introduce major new features
* introduce major AI functionality
* alter important electrical calculations
* change quoting logic
* change authentication/permissions behaviour
* change Supabase architecture
* migrate major systems solely because you prefer another approach

Document these recommendations instead.

---

## 33. GIT SAFETY

THIS IS NON-NEGOTIABLE.

Create a dedicated redesign branch.

DO NOT MERGE.

DO NOT modify the main branch.

DO NOT delete the existing implementation.

Make logical commits/checkpoints throughout the process.

Push the redesign branch if you have GitHub access.

I want to be able to review the entire result before anything is merged.

If you are uncertain whether something is safe to change:

DO NOT GUESS.

Document it.

---

## 34. CLAUDE-MEM

Use Claude-mem aggressively where useful.

Retrieve relevant historical context about:

* previous SparkyDraft decisions
* product direction
* previous UI decisions
* known bugs
* feature discussions
* architecture decisions
* user workflows
* previous redesign experiments
* previous reasoning about the application

However:

The CURRENT GitHub repository is the source of truth for the current implementation.

Historical memory must NOT override the current codebase.

---

## 35. FINAL PRODUCT REVIEW

When the redesign is complete, perform a proper product audit.

Give me:

### A. DESIGN REVIEW

What you changed and why.

### B. CAD UX REVIEW

What professional CAD interaction patterns were incorporated.

### C. ELECTRICAL WORKFLOW REVIEW

What makes the interface specifically appropriate for electrical drafting.

### D. COMPETITOR GAP ANALYSIS

What relevant competitors do that SparkyDraft currently doesn't.

Separate:

ESSENTIAL
HIGH VALUE
OPTIONAL
NOT WORTH COPYING

### E. UX PROBLEMS

What is currently unnecessarily complicated.

### F. FEATURES WE SHOULD CONSIDER

Rank:

🔴 Critical
🟠 High value
🟡 Useful
🟢 Nice-to-have
⚪ Do not build

For every recommendation explain:

* what it is
* why users would want it
* business value
* implementation complexity
* competitor precedent
* whether you recommend it

### G. FEATURES WE SHOULD REMOVE OR SIMPLIFY

Do NOT remove them.

Recommend them for my approval.

### H. TECHNICAL REVIEW

Assess:

* architecture
* component structure
* design system
* performance
* responsiveness
* accessibility
* maintainability
* scalability
* technical debt

### I. TESTING

Actually test the application.

Do not merely inspect the code and say it works.

Test important workflows through the browser.

Test desktop, tablet and mobile behaviour.

Test the drafting interactions.

Test navigation.

Test forms.

Test project functionality.

Test relevant Supabase interactions.

Check console errors.

Check for broken interactions.

### J. GIT STATUS

Tell me:

* branch name
* commits created
* whether pushed
* confirmation that NOTHING was merged

---

## FINAL OBJECTIVE

When you are finished, I want SparkyDraft to feel like:

"A serious professional electrical drafting tool that happens to be incredibly easy to use."

NOT:

"A website with a drawing tool inside it."

And NOT:

"A generic SaaS dashboard with CAD features."

Prioritise:

PRECISION
→ SPEED
→ CLARITY
→ WORKFLOW
→ PROFESSIONALISM
→ RESPONSIVENESS
→ SCALABILITY

over decorative design.

Do not optimise for screenshots.

Optimise for someone using SparkyDraft for several hours to actually complete electrical drafting work.

And again:

DO NOT MERGE ANYTHING.

I will review the redesign and recommendations first.

For your full SparkyDraft redesign:
➡️ Opus 5 + High
➡️ Claude-mem ON
➡️ Co-work/browser ON when needed
➡️ GitHub separate redesign branch
➡️ NO MERGE

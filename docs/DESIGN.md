# Departmental Reorg Payroll Rollup Tracker — Design

**Status:** design agreed, implementation not started
**How to read this:** every section starts with the plain idea, then the detail. If a section makes sense after the first paragraph, skip the rest.
**Purpose:** the single technical spec for this project. Later prompts cite a section (`§6.2`) instead of re-pasting the problem statement.

---

## 0. The running example

Every explanation in this document uses the small org from the problem statement, so you only ever have to hold one picture in your head.

```
                    HOD  150000
                   /            \
          MGR_A  80000       MGR_B  75000
          /         \
   LEAD_A  60000   E_Y  45000
       |
    E_X  40000
```

Team totals **include yourself**:

| Who | Headcount | Payroll | How |
|---|---|---|---|
| E_X | 1 | 40000 | leaf: just himself |
| E_Y | 1 | 45000 | leaf |
| MGR_B | 1 | 75000 | leaf (no reports yet) |
| LEAD_A | 2 | 100000 | self 60000 + E_X 40000 |
| MGR_A | 4 | 225000 | self 80000 + LEAD_A's team 100000 + E_Y 45000 |
| HOD | 6 | 450000 | self 150000 + MGR_A's team 225000 + MGR_B 75000 |

**The demo move:** LEAD_A (and E_X, who comes along) transfers from MGR_A to MGR_B.

```
                    HOD  150000
                   /            \
          MGR_A  80000       MGR_B  75000
              |                   |
          E_Y  45000        LEAD_A  60000
                                 |
                             E_X  40000
```

| Who | Before | After | Changed? |
|---|---|---|---|
| MGR_A | 4 / 225000 | 2 / 125000 | **yes** — lost 2 people |
| MGR_B | 1 / 75000 | 3 / 175000 | **yes** — gained 2 people |
| HOD | 6 / 450000 | 6 / 450000 | no |
| LEAD_A | 2 / 100000 | 2 / 100000 | no — moved, but its team is intact |
| E_X, E_Y | unchanged | unchanged | no |

Notice **HOD doesn't change.** Those two people were in the department before and are in the department after — they just sit somewhere else. That single observation is the whole of §7, and it's worth sitting with for a moment before reading on.

---

## 1. What this problem actually is

Strip the HR language and there are three jobs:

| The requirement says | Which really means |
|---|---|
| "turn the flat list into one validated reporting tree" | prove the manager references form a proper tree — no loops, nobody orphaned |
| "team headcount and payroll for every employee" | add up each person's whole sub-team, bottom-up |
| "move an employee or team to a different manager" | change one person's manager, with checks |

Everything else — highlighting, impact panels, reset — is display over these three.

### The one fact that decides every design trade-off

**`n ≤ 30`.** Thirty employees, maximum, ever.

Every algorithm here is `O(n)` or `O(depth)`. On 30 records that is *instant* — a modern machine does this hundreds of thousands of times per second. So there is never a performance reason to pick one approach over another.

That frees us to always pick **the version that is most obviously correct**, even when a cleverer, faster version exists. You'll see this twice: in §5 (we recompute all totals instead of patching a few) and in §7 (we compare all values instead of calculating which ones *should* have changed). Both times the "dumb" version wins because it cannot be subtly wrong.

Knowing when *not* to optimise is a real engineering judgement, and it's worth saying out loud when you present this.

---

## 2. How the data is stored

### 2.1 One array. That's it.

```
employees: Employee[]        // in SOURCE ORDER, never reordered

Employee {
    employee_id:    string     // matches [A-Z][A-Z0-9_-]{0,15}
    name:           string     // non-empty after trim
    role:           string     // non-empty after trim
    monthly_salary: integer    // 1 .. 1_000_000
    manager_id:     string | null    // null only for the HOD
}
```

**There is no tree object.** No `Node` class, no `children` array, no pointers between records. The tree is *implied* by the `manager_id` fields, exactly the way the input file gives it to you.

### 2.2 Building the lookups

Three helper structures, rebuilt from scratch whenever anything changes:

| Structure | What it holds | Why |
|---|---|---|
| `byId` | id → employee record | O(1) lookup instead of scanning |
| `childrenOf` | id → list of that person's direct reports | to walk downward |
| `rollups` | id → `{headcount, payroll}` | the computed totals |

Building `childrenOf` is one loop:

```
buildChildIndex(employees):
    childrenOf = empty map
    for e in employees:                        // ← walk in SOURCE ORDER
        childrenOf[e.manager_id].append(e.id)  // ← append keeps that order
    return childrenOf
```

**Read those two comment lines together, because they're the trick.** We visit employees in source order and *append*. So each manager's list of reports comes out in source order automatically. We never sort it, and we never can get it wrong.

### 2.3 Why not a normal tree with child pointers?

The textbook approach would be:

```
Node { id, salary, parent, children: [] }
move:  oldParent.children.remove(node)
       newParent.children.insert(node, ???)     // ← at which position?
```

This works. But look at that `???`. The requirement says a manager's reports must stay in original source order, and after a move the transferred person must land in **the position implied by their source record**. So on every move you'd have to compute the right insertion index — scan the new siblings, work out where this person's source position falls, splice them in there.

That's a fiddly calculation you have to get right every time. In our model it doesn't exist, because we rebuild the list from the source array (§2.2) and appending *is* the ordering.

That's the first of four wins. All four:

**(a) Sibling order is automatic.** Explained above. There is no insertion index anywhere in this codebase, so there's no insertion index to get wrong.

**(b) The move is a single field write.**

```
e.manager_id = new_manager_id      // done
```

No removing from one list, no inserting into another. With child pointers there's a moment where the node sits in *two* `children` arrays — if anything throws in between, your tree is corrupt.

**(c) Undo is free, so "reject safely" is free.** The requirement says a rejected transfer must leave the department *exactly* as it was. Our state is one array of 30 plain objects, so copying it is trivial. Every transfer works like this:

```
1. check everything
2. if any check fails → return the error, original array never touched
3. otherwise → copy the array, edit the copy, recompute, return the copy
```

We can't accidentally leave things half-changed, because we never edit the real thing until we know the move is legal. "Atomic rejection" stops being a rule you must remember and becomes something the shape of the code makes impossible to violate.

**(d) "The moved team stays intact" is guaranteed, not hoped for.** When LEAD_A moves, why does E_X come along? Because E_X's record says `manager_id: LEAD_A`, and we **didn't touch E_X's record.** We only wrote to LEAD_A's. So E_X is still under LEAD_A, wherever LEAD_A now sits.

This is worth pausing on: in a pointer-tree you'd move a node and *trust* the subtree hangs off it. Here, the subtree can't detach — nothing that defines it was modified. We still test it, but the test confirms something already proven.

**The general principle:** keep one source of truth, rebuild everything else from it. This kills the entire bug family of "two copies of the structure disagreed." At 30 records, rebuilding costs nothing.

---

## 3. Invariants — things that must always be true

If one of these ever fails, it's a bug in our code, not an interesting edge case.

| # | Must always hold | Why it matters |
|---|---|---|
| I1 | HOD's headcount == total number of employees | everyone is under the HOD; if not, someone is orphaned |
| I2 | HOD's payroll == sum of all salaries | same reasoning, in money |
| I3 | every leaf has headcount 1, payroll == own salary | "team includes yourself" |
| I4 | the `employees` array's order and length never change after load | a transfer writes one field, nothing else |
| I5 | all maths is integer; formatted text never re-enters a calculation | see below |
| I6 | exactly one record has `manager_id == null` | one HOD |

**On I5.** Compute and store `225000`. Display `₹2,25,000`. Never read that string back and parse it into a number — formatting is a one-way street at the very edge of the app.

**I1 and I2 are your free correctness alarm.** Assert them after every recalculation. If your tree-building or your totals are wrong in almost any way, one of these two fires immediately.

---

## 4. Validating the input

### 4.1 The order of checks is forced

The requirement says: report errors in this order — bad field or count → duplicate ID → root count → self/unknown manager → cycle.

That's not someone's preference. **Each check needs the previous one to have passed:**

- Can't check for duplicate IDs until you know the IDs are well-formed.
- Can't count how many people have no manager until you know IDs are unique.
- Can't check whether `manager_id: "MGR_Z"` points at a real person until you have the final ID list.
- Can't look for loops until you know every arrow points at somebody real.

So it's a pipeline. First failure wins, stop immediately:

```
LOAD_CHECKS = [ checkCountAndFields,      // §4.2 step 1
                checkDuplicateIds,        // step 2
                checkRootCount,           // step 3
                checkManagerReferences,   // step 4
                checkSingleConnectedTree ]// step 5

validate(records):
    for check in LOAD_CHECKS:
        err = check(records)
        if err: return Failure(err)
    return Success(...)
```

### 4.2 The five checks

**1 — count and fields → `INVALID_EMPLOYEE`**
`n` outside 1..30, or any record with a malformed ID, blank name/role after trimming, or a salary that isn't a whole number in 1..1,000,000. Scan in source order, report the first bad record with its index and which field is wrong.

> **Assumption, recorded on purpose.** The spec says reject if "the employee count or a field is invalid" but gives no separate code for a bad count. We use `INVALID_EMPLOYEE` with a message naming the count. Written down so it's a visible decision, not a silent one.

**2 — duplicate IDs → `DUPLICATE_EMPLOYEE_ID`**
First ID seen twice, in source order. Report the ID and both positions.

**3 — root count → `INVALID_ROOT_COUNT`**
Count records with `manager_id == null`. Must be exactly 1. Zero means no HOD; two or more means two separate org charts.

**4 — manager references → `SELF_MANAGER` / `UNKNOWN_MANAGER`**

> **This one has a trap.** These two codes are **one category** in the precedence list, broken by source order — *not* two categories in sequence.
>
> - Record 3 has an unknown manager, record 5 manages themselves → report **record 3's `UNKNOWN_MANAGER`** (earlier record wins).
> - Record 2 manages themselves, record 4 has an unknown manager → report **record 2's `SELF_MANAGER`**.
>
> So: **one loop in source order**, checking both conditions on each record, returning whichever it meets first. The natural mistake is writing two separate loops — that makes one code always beat the other regardless of position, and a precedence test will catch it.

Managing yourself is technically a loop of length 1, but it's caught here with its own code, so it never reaches step 5.

**5 — one connected tree → `MANAGEMENT_CYCLE`** — §4.3.

### 4.3 Finding loops without writing a loop-detector

**The intuition.** Every employee writes down exactly one name: their manager. The HOD writes "nobody." Picture each person holding an arrow pointing at their boss.

Now start at *any* employee and follow the arrows upward. At each step there's exactly one place to go — no choices, no dead ends, because step 4 already proved every name refers to a real person.

So the walk can only end two ways:

- **You reach the HOD.** They have no arrow. You stop. ✓
- **You never reach the HOD.** But the company is finite, so you can't walk forever without repeating someone. The moment you revisit someone, you're **going in circles.** ✗

There is no third outcome. Either you get to the top, or you're stuck in a loop.

**Now flip it around.** "Can I walk *up* from X to the HOD?" and "can I walk *down* from the HOD to X?" are the same question — same arrows, read the other way.

So: **start at the HOD and walk down, marking everyone you reach.** Anyone you *miss* is someone who couldn't walk up to the HOD — and by the argument above, that means they're in a loop or hanging off one.

```
visited = walk down from root using childrenOf      // BFS or DFS, O(n)

if visited.size == n   → valid tree
if visited.size <  n   → there's a cycle
```

**That's it.** One walk. You do not write a separate cycle-detector with colour-marking or recursion stacks. The traversal you needed anyway answers both "is everyone connected?" and "are there loops?" at the same time.

> **The formal version, if you like it stated that way.** Each non-root contributes exactly one edge, so there are `n` nodes and `n − 1` edges. A graph with `n` nodes and `n − 1` edges is a tree if and only if it's connected. The arrow-walking argument above is the same fact without the counting.

### 4.4 Telling the user *which* people are in the loop

Counting tells you a loop exists but not who's in it, and the spec wants a message naming them. So on failure only, do one short extra walk:

```
identifyCycle(someUnvisitedPerson):
    seen = ordered list
    cur  = someUnvisitedPerson
    while cur not already in seen:
        seen.append(cur)
        cur = byId[cur].manager_id
    return seen from the position of cur onward    // ← the loop itself
```

You walk up collecting names until you hit a name you've already collected. That repeat is where the circle closes, so everything from that point onward *is* the circle.

Example: if A→B→C→D→B, you collect `[A, B, C, D]`, then hit `B` again. `B` is at position 1, so the cycle is `[B, C, D]`. `A` was just the tail leading into it.

`O(depth)`, only runs when something's already broken.

### 4.5 A failed load wipes everything

If loading fails, the whole app state is replaced with an error state — no partial tree, no totals, and crucially **no leftovers from a department that loaded successfully earlier.**

This is easy because load *returns a whole new state* rather than editing the existing one. There's no "clear the old stuff" code to forget to write; the old state simply isn't carried forward.

---

## 5. Computing the totals

### 5.1 Bottom-up, because you can't do it any other way

```
team_headcount(e) = 1 + sum of children's team_headcount
team_payroll(e)   = own salary + sum of children's team_payroll
```

**Why the order is forced:** you can't total MGR_A until you know LEAD_A's total, and you can't know LEAD_A's until you know E_X's. Children first, always. That's what **post-order** means — do all the children, *then* do yourself.

```
rollup(e):
    hc = 1;  pay = salary[e]                 // start with yourself
    for c in childrenOf[e]:
        (childHc, childPay) = rollup(c)      // finish the child completely first
        hc  += childHc
        pay += childPay
    rollups[e] = (hc, pay)
    return (hc, pay)
```

Trace it on the example: `rollup(HOD)` calls `rollup(MGR_A)`, which calls `rollup(LEAD_A)`, which calls `rollup(E_X)`. E_X is a leaf → returns `(1, 40000)`. LEAD_A becomes `(1+1, 60000+40000) = (2, 100000)`. Then E_Y returns `(1, 45000)`, so MGR_A becomes `(1+2+1, 80000+100000+45000) = (4, 225000)`. And so on up.

Recursion is safe here — depth can't exceed 30.

### 5.2 The no-recursion version (reference only)

Worth knowing but not what we ship:

```
order = BFS from root                        // parents always come before children
for i = last down to first:                  // reversed ⇒ children before parents
    e = order[i]
    hc[e] += 1;  pay[e] += salary[e]
    hc[parent[e]]  += hc[e]
    pay[parent[e]] += pay[e]
```

BFS visits by level, so a parent always appears before its children. Read the list **backwards** and every child is finished before its parent is touched — which is exactly what a bottom-up total needs, with no recursion.

**Decision: ship §5.1.** It reads better. §5.2 is what you'd reach for if the tree could be thousands deep and blow the call stack.

### 5.3 Inspecting a person changes nothing

Clicking someone reads `byId`, `childrenOf[e].length`, and `rollups[e]`. No traversal, no mutation. The requirement that inspection must not change the tree is satisfied by there being nothing to change.

---

## 6. The transfer

### 6.1 Shape

```
applyTransfer(state, {employee_id, new_manager_id})
    → { ok: true,  state: newState }
    | { ok: false, code, message }      // original state untouched
```

All checks run *before* anything is written (§2.3c).

### 6.2 The five rejection checks, in this exact order

| Order | Code | Reject when |
|---|---|---|
| 1 | `UNKNOWN_TRANSFER_EMPLOYEE` | either ID doesn't exist |
| 2 | `ROOT_MOVE_FORBIDDEN` | you're trying to move the HOD |
| 3 | `SELF_MANAGER` | both IDs are the same person |
| 4 | `ALREADY_REPORTS_TO_MANAGER` | they already report to that manager |
| 5 | `MANAGEMENT_CYCLE` | the new manager is somewhere *below* this person |

**Check 5 in plain terms:** you can't make LEAD_A report to E_X, because E_X works for LEAD_A. LEAD_A would end up being their own boss's boss — a loop.

> **A consequence to be aware of.** If someone submits "move the HOD to report to the HOD," they get `ROOT_MOVE_FORBIDDEN`, not `SELF_MANAGER`, because check 2 runs before check 3. That's observable behaviour, so it gets a test — otherwise someone later "fixes" it into a bug.

Checks 2 and 3 also make check 5 simpler: by the time you get there, you know the person isn't the root and isn't the same as the target.

### 6.3 Check 5: walk up, not down

Two ways to ask "is the new manager inside this person's team?":

- **Search downward:** walk the whole team under LEAD_A looking for the target. Could visit up to 30 people.
- **Walk upward:** start at the target and follow manager arrows up, looking for LEAD_A. Visits at most `depth` people — usually 2 or 3.

Take the upward walk. Fewer steps, no recursion, no visited-set, and it's four lines:

```
isAncestor(boss, person):            // "is `boss` somewhere above `person`?"
    cur = person
    while cur != null:
        if cur == boss: return true
        cur = byId[cur].manager_id
    return false

// reject if isAncestor(employee_id, new_manager_id)
```

Reading it on the example: to test "move LEAD_A under E_X," walk up from E_X → LEAD_A. Found LEAD_A → reject. To test "move LEAD_A under MGR_B," walk up from MGR_B → HOD → null. Never found LEAD_A → allowed. ✓

**Nice detail:** this loop is guaranteed to terminate *because §4.3 already proved there are no cycles.* Validating the tree once buys you a cheap, safe query forever after.

### 6.4 Doing the move

```
next = copy of state.employees                       // shallow copy, ~30 objects
next[position of employee_id].manager_id = new_manager_id
rebuild byId, childrenOf, rollups from next          // O(n), see §2.2 and §5.1
```

Three lines. Both affected managers' report-lists come out correct and in source order for free, because `childrenOf` is rebuilt by a source-order pass. Nobody else's relative order shifts. Nothing is spliced anywhere.

---

## 7. Which totals changed

### 7.1 What we actually ship: compare before and after

```
before  = the rollups we had                  // captured before the move
after   = recompute(next)

changed = [ e.employee_id  for e in next            // ← source order, free
            if before[e.id].headcount != after[e.id].headcount
            or before[e.id].payroll   != after[e.id].payroll ]
```

Save the old numbers, compute the new numbers, list who differs. `O(n)`, impossible to get wrong, and it's literally how the requirement defines the field.

Looping over `next` (our source-ordered array) rather than over a map gives the required ordering with no sorting. That's the third time the §2 layout pays off.

### 7.2 Why only those people change — the fork-point idea

You don't need this to build the app. You need it to *explain* the app, and it turns one confusing line in the requirements into something obvious.

**Start here:** your team payroll is just "the total salary of everyone sitting under me, including me." So:

> **Your numbers change if and only if the set of people under you changed.**

Now, LEAD_A's team (2 people, 100000) walks out of MGR_A's org and into MGR_B's. Ask each manager one question: *"were they under me before, and are they under me after?"*

| Manager | Under me before? | Under me after? | Changed? |
|---|---|---|---|
| MGR_A | yes | no | **yes** — lost them |
| MGR_B | no | yes | **yes** — gained them |
| HOD | yes | yes | **no** — had them all along |
| E_Y | no | no | **no** — never involved |

**Only "yes/no" and "no/yes" change. "Yes/yes" and "no/no" don't.**

Now, when *is* a team under you? Exactly when you're the old boss or anywhere above the old boss. So:

- "under me before" = you're on the chain **MGR_A → HOD**
- "under me after" = you're on the chain **MGR_B → HOD**

Both chains run to the top, so they eventually merge. Call the merge point the **fork point** — the first manager standing above *both* the old boss and the new boss. Here, that's HOD.

```
                HOD          ← the fork point: on BOTH chains → no change
               /   \
          MGR_A     MGR_B    ← each on only ONE chain → both change
```

**From the fork upward, you're on both chains → yes/yes → nothing changes.**
**Below the fork, you're on exactly one chain → you either gained or lost them → you change.**

So the answer is: *everyone between the old boss and the fork, plus everyone between the new boss and the fork.* Here: `{MGR_A}` and `{MGR_B}`. The fork point itself and everything above it is untouched.

(The formal name for the fork point is the **lowest common ancestor**, and the changed set is the symmetric difference of the two root-paths — but "fork point" is the same thing in words you can say out loud in a demo.)

**This explains the requirement line that otherwise looks arbitrary:**

> *"Do not label an unchanged common ancestor as financially affected merely because it remains above both branches."*

**That sentence is describing the fork point.** HOD sits above both branches, so it's tempting to mark it "affected" — but its numbers are identical, because the people never left. It's a structural fact, not a display preference.

**Two consequences that match the requirements exactly:**

- **The moved person's own numbers don't change.** LEAD_A is still 2 / 100000 — their team came with them. That's why the spec says the moved employee "may be shown separately even when their own rollup values did not change." They get a *moved* highlight, not a *changed* highlight. Two different visual states, deliberately.
- **The HOD never changes on any internal move.** There's always a fork point at or below the root, so the root is never in the changed list. Which is why the acceptance criteria demand the department head's totals stay put.

**Why the comparison in §7.1 can't miss anyone:** if the set of people under you changed, it changed by *at least one person* (the moved team always contains at least the moved person). So headcount always moves. There's no way for a change to hide. (Payroll moves too, since every salary is ≥ 1 — but headcount alone already guarantees we catch it.)

**A second worked check, different shape.** Move E_Y from MGR_A up to HOD directly. Old-boss chain: MGR_A → HOD. New-boss chain: HOD. Fork point = HOD. Changed = `{MGR_A}` only — MGR_A drops to 3 / 180000, HOD stays 6 / 450000 because it still has everyone. Correct: when the new boss is *already above* the old boss, one side of the fork is empty.

### 7.3 Use the fork-point rule in tests, not in the app

The fork-point method is faster (`O(depth)` vs `O(n)`), but at 30 records that saving is worth nothing, and it's the kind of reasoning that's subtly wrong in edge cases.

So:

- **The app** uses §7.1 — compare all the numbers. Boring, unbreakable.
- **The tests** assert that §7.1's answer matches the fork-point prediction computed independently.

Two completely different methods agreeing on the same answer is far stronger evidence than either alone — and it's exactly the "work it out independently, don't just trust the code" discipline the problem statement keeps demanding.

---

## 8. Cost of everything

| Operation | Cost | On 30 records |
|---|---|---|
| field / duplicate / root checks | `O(n)` | instant |
| tree validation (§4.3) | `O(n)` | instant |
| naming a cycle (only on failure) | `O(depth)` | instant |
| rebuilding indexes | `O(n)` | instant |
| computing all totals | `O(n)` | instant |
| transfer validation (§6.3) | `O(depth)` | instant |
| transfer + recompute + diff | `O(n)` | instant |

Everything is linear. Nothing here needs optimising. See §1.

---

## 9. Error codes

**Load:** `INVALID_EMPLOYEE`, `DUPLICATE_EMPLOYEE_ID`, `INVALID_ROOT_COUNT`, `UNKNOWN_MANAGER`, `SELF_MANAGER`, `MANAGEMENT_CYCLE`

**Transfer:** `UNKNOWN_TRANSFER_EMPLOYEE`, `ROOT_MOVE_FORBIDDEN`, `SELF_MANAGER`, `ALREADY_REPORTS_TO_MANAGER`, `MANAGEMENT_CYCLE`

Exported as constants from the engine so tests and UI reference the same symbols — never a typed string literal in two places. Every error carries a readable message naming the record index, ID, or cycle members. `SELF_MANAGER` and `MANAGEMENT_CYCLE` intentionally appear in both lists.

---

## 10. File layout

```
src/
  engine/          ← pure logic. no DOM, no UI framework, no file reading.
    validate       §4
    rollup         §5
    transfer       §6, §7
    codes          §9
  ui/              ← displays what the engine returns. computes nothing itself.
  data/
    department.*   ← the 12-employee fixture (real input to the app)
tests/
  fixtures/
    expected.*     ← hand-worked answers. TESTS ONLY. never imported by src/.
```

**Two rules that matter:**

**1. `engine/` imports nothing from `ui/`.** The engine can be tested with no browser at all. That separation is itself the evidence that the app computes its own results rather than leaning on the display layer.

**2. The expected answers are quarantined.** The problem says the app must calculate its own results and must **not** read the documented answers as input. So `tests/fixtures/expected.*` is imported by tests and nothing else.

Don't leave that on trust — **write a test that scans `src/` for any import of the expected fixture and fails if it finds one.** Five lines, and it's an obvious thing for an evaluator to check.

---

## 11. Test list

| Area | What it asserts |
|---|---|
| leaf totals | headcount 1, payroll == own salary |
| multi-level totals | every person matches the hand-worked sheet |
| root invariants | I1 and I2 (§3) |
| one-person department | n=1, headcount 1, payroll == salary |
| moved team intact | the subtree under the moved person is identical afterwards |
| valid transfer | post-move totals match the hand-worked sheet |
| changed list | §7.1 diff == §7.2 fork-point prediction == documented IDs |
| sibling order | reports in source order, before and after the move |
| cycle rejection | descendant-as-manager → `MANAGEMENT_CYCLE`, **both** before and after the valid transfer |
| root protection | moving the HOD → `ROOT_MOVE_FORBIDDEN` |
| rejection is safe | after any rejection, state deep-equals the pre-attempt state |
| bad load — duplicate ID | `DUPLICATE_EMPLOYEE_ID` |
| bad load — unknown manager | `UNKNOWN_MANAGER` |
| bad load — cycle | `MANAGEMENT_CYCLE`, message names the cycle members |
| error precedence | multi-error input reports the §4.1 order; self/unknown broken by source order (§4.2 step 4) |
| bad load clears state | a failed load after a good one leaves no stale tree or totals |
| reset | restores records, totals, default selection, cleared highlights |
| repeatability | reset → same transfer again → identical result |
| fixture quarantine | no `src/` file imports the expected answers |

---

## 12. Still to decide

| # | Decision | Status |
|---|---|---|
| D1 | Technology stack | **open** — the engine is deliberately framework-free, so this doesn't affect §1–§9 |
| D2 | Side-by-side comparison drawer (optional credit) | **open** — cheap, since we already keep the original for Reset; it's just a second render |
| D3 | The 12-employee fixture + hand-worked totals | **next up** — needs one HOD, ≥2 branches, ≥3 managers, ≥1 movable non-leaf lead, ≥1 person 3+ levels down, distinct salaries |
| D4 | How to draw the tree | **leaning:** hand-written recursive render with CSS lines, no graph library — predictable layout, nothing to justify, full control over highlighting |

---

## 13. Using this file with an AI assistant

This document *is* the technical specification the problem statement asks you to produce from the brief. It exists to be **cited, not re-explained.**

- Point at sections: *"implement `applyTransfer` per §6.2 and §6.4, return shape per §6.1."*
- **Never re-paste the problem statement** into a coding prompt. Everything binding is captured here.
- When a decision changes, **edit this file first, then write code.** The history of this file is the record of how your plan evolved — which is itself something you're graded on.

---

## 14. Suggested order of work

Build the engine before the UI. It's where the correctness lives, it's testable without a browser, and if time runs short a well-tested engine with a plain UI scores far better than a polished UI with untested logic.

| Order | Do this | Done when |
|---|---|---|
| 1 | **D3** — design the 12-person org, work the totals out by hand | numbers computed twice, independently; I1 and I2 check out on paper |
| 2 | Engine: validation (§4) + totals (§5) | hand-worked numbers reproduced; bad-load tests pass |
| 3 | Engine: transfer (§6) + changed list (§7) | valid move, both rejections, and rejection-safety tests pass |
| 4 | UI: tree, table, detail panel, total cards | load in one action, click anyone, see their numbers |
| 5 | UI: transfer controls, impact panel, highlights, reset | full walkthrough of the acceptance criteria works live |
| 6 | Write-up: prompt log, plan-vs-actual, screenshots; drawer if time | demo rehearsed start to finish |

**Checkpoint after step 3:** at that moment every "Required" acceptance criterion is already *provable* — the UI just has to display it. If you're behind schedule, that's the point to simplify the UI, never the engine.

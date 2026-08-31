# Departmental Reorg Payroll Rollup Tracker — the design, in C++

**What this file is.** The full design ([docs/DESIGN.md](docs/DESIGN.md)) written as real, compiling C++ so the data structures and algorithms are concrete instead of pseudocode.

**What this file is not.** The deliverable. The final app needs an interactive tree in a browser, so the shipped engine will be JavaScript/TypeScript. But the algorithms are *identical* — only the syntax changes. Read this to understand; translate later.

**It compiles and runs.** See §12. That makes it a second, independent way to check the hand-worked totals later.

---

## 0. The example we'll use throughout

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

| Who | Headcount | Payroll | Working |
|---|---|---|---|
| E_X | 1 | 40000 | leaf — just himself |
| E_Y | 1 | 45000 | leaf |
| MGR_B | 1 | 75000 | leaf (no reports yet) |
| LEAD_A | 2 | 100000 | 60000 + E_X's 40000 |
| MGR_A | 4 | 225000 | 80000 + LEAD_A's team 100000 + E_Y's 45000 |
| HOD | 6 | 450000 | 150000 + MGR_A's team 225000 + MGR_B's 75000 |

**The demo move:** LEAD_A transfers from MGR_A to MGR_B. E_X comes along automatically.

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
| LEAD_A | 2 / 100000 | 2 / 100000 | no — moved, but team intact |

**HOD doesn't change.** Those two people were in the department before and are in it after — they just sit elsewhere. That one observation is all of §7.

---

## 1. The core types

```cpp
#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <optional>
#include <cstdint>

// A manager_id is either a real ID, or "nobody" for the department head.
// std::optional expresses "may be absent" far better than an empty string,
// because an empty string is a *value* that could be confused with a real ID.
using ManagerId = std::optional<std::string>;

struct Employee {
    std::string employee_id;      // matches [A-Z][A-Z0-9_-]{0,15}
    std::string name;             // non-empty after trimming
    std::string role;             // non-empty after trimming
    long long   monthly_salary;   // 1 .. 1'000'000, ALWAYS integer
    ManagerId   manager_id;       // std::nullopt only for the HOD
};

struct Rollup {
    long long headcount = 0;
    long long payroll   = 0;      // integer rupees. never double.
};
```

**Why `long long` and never `double`.** Money must be exact. `double` cannot represent every integer beyond 2^53 and introduces rounding you can't see until totals disagree by a rupee. Max possible payroll here is 30 × 1,000,000 = 30,000,000 — comfortably inside `long long`. The requirement "calculate with exact whole currency units" is a *type choice*, made once, here.

---

## 2. How the data is stored

### 2.1 One vector. That's the whole state.

```cpp
struct Department {
    std::vector<Employee> employees;    // SOURCE ORDER. never reordered.
};
```

**There is no tree object.** No `Node`, no `children` pointers. The tree lives entirely inside the `manager_id` fields — exactly as the input gives it to you.

### 2.2 The derived lookups

Three helpers, rebuilt from scratch whenever anything changes:

```cpp
struct Indexes {
    // byId holds a COPY, not a pointer -- see the warning below.
    std::unordered_map<std::string, Employee>                 byId;
    std::unordered_map<std::string, std::vector<std::string>> childrenOf;
    std::string                                               rootId;
};

Indexes buildIndexes(const std::vector<Employee>& employees) {
    Indexes ix;
    for (const Employee& e : employees)
        ix.byId[e.employee_id] = e;      // copy, not pointer

    for (const Employee& e : employees) {      // <-- walk in SOURCE ORDER
        if (e.manager_id.has_value())
            ix.childrenOf[*e.manager_id].push_back(e.employee_id);
                                               // <-- push_back keeps that order
        else
            ix.rootId = e.employee_id;
    }
    return ix;
}
```

**Read those two comment lines together — that's the trick.** We iterate in source order and `push_back`. So every manager's report list comes out in source order automatically. We never sort it, and we cannot get it wrong.

> **A bug this actually caused, worth learning from.** The first draft stored `const Employee*` in `byId` — the obvious choice, since copying seems wasteful. But `applyTransfer` builds a new `AppState` locally and returns it by value. The copy gets a fresh `employees` vector while the pointers still aim at the *old* one, which dies at return. Result: dangling pointers. The totals still printed correctly (they were computed before the copy), so the tree rendered with **correct numbers but blank names and salary 0** — a bug that hides in exactly the field you're not checking.
>
> This is the "two representations drifted apart" failure this whole section warns about, arriving through the back door: a derived index that outlived its source. The fix is to obey our own rule — **derived data must never be storable independently of what it derives from.** Copying 30 small structs costs nothing.
>
> In JavaScript this specific crash can't happen (references keep objects alive), but the *shape* of the mistake does: holding a stale index built from an old array. The defence is identical — rebuild indexes from the source array, never carry them across a state change.

### 2.3 Why not a normal tree with child pointers?

The textbook approach:

```cpp
struct Node {
    std::string id;
    long long salary;
    Node* parent;
    std::vector<Node*> children;
};

// moving someone:
oldParent->children.erase(find(oldParent->children, node));
newParent->children.insert(/* AT WHICH POSITION? */, node);
//                          ^^^^^^^^^^^^^^^^^^^^^
```

Look at that insert. The requirement says a manager's reports must stay in original source order, and a transferred person must land in **the position implied by their source record**. So you'd have to compute the correct index every time — scan the new siblings, work out where this person's source position falls, splice them there.

In our model that computation **does not exist**, because we rebuild the list from the source vector and `push_back` *is* the ordering.

That's one of four wins:

**(a) Sibling order is automatic.** No insertion index anywhere in the codebase, so no insertion index to get wrong.

**(b) The move is one field write.**

```cpp
employees[i].manager_id = new_manager_id;   // done. that's the entire move.
```

With child pointers there's a moment where the node sits in *two* `children` vectors. Throw an exception in between and the tree is corrupt.

**(c) Undo is free, so "reject safely" is free.**

```cpp
std::vector<Employee> next = dept.employees;   // copy 30 small structs
next[i].manager_id = new_manager_id;           // edit the COPY
// if anything was wrong, we simply never assign `next` back.
```

The requirement says a rejected transfer must leave things *exactly* as they were. We can't leave things half-changed, because we never touch the real vector until we know the move is legal. Atomicity stops being a rule you must remember and becomes something the code's shape makes impossible to violate.

**(d) "The moved team stays intact" is guaranteed, not hoped for.**

When LEAD_A moves, why does E_X follow? Because E_X's record says `manager_id = "LEAD_A"`, and **we never touched E_X's record.** So E_X is still under LEAD_A, wherever LEAD_A now sits.

Sit with that one. In a pointer tree you move a node and *trust* the subtree hangs off it. Here the subtree cannot detach, because nothing that defines it was modified.

**The principle:** keep one source of truth, rebuild everything else from it. This kills the whole bug family of "two copies of the structure disagreed." At 30 records, rebuilding costs nothing.

---

## 3. Invariants

If one of these ever fails, it's a bug in our code — not an interesting edge case.

```cpp
#include <cassert>

void assertInvariants(const std::vector<Employee>& employees,
                      const std::unordered_map<std::string, Rollup>& rollups,
                      const std::string& rootId) {
    long long totalSalary = 0;
    for (const Employee& e : employees) totalSalary += e.monthly_salary;

    // I1: everyone is under the HOD
    assert(rollups.at(rootId).headcount == (long long)employees.size());
    // I2: same fact, in money
    assert(rollups.at(rootId).payroll   == totalSalary);
}
```

| # | Must always hold |
|---|---|
| I1 | root headcount == number of employees |
| I2 | root payroll == sum of all salaries |
| I3 | every leaf has headcount 1, payroll == own salary |
| I4 | the `employees` vector's order and size never change after load |
| I5 | all maths is integer; formatted text never re-enters a calculation |
| I6 | exactly one record has `manager_id == std::nullopt` |

**I1 and I2 are your free correctness alarm.** Call `assertInvariants` after every recalculation. If tree-building or totalling is wrong in almost any way, one of these fires immediately.

**On I5.** Compute and store `225000`. Display `₹2,25,000`. Never parse that string back into a number — formatting is a one-way street at the very edge of the app.

---

## 4. Validating the input

### 4.1 The order of checks is forced

```cpp
enum class ErrorCode {
    NONE,
    INVALID_EMPLOYEE, DUPLICATE_EMPLOYEE_ID, INVALID_ROOT_COUNT,
    UNKNOWN_MANAGER, SELF_MANAGER, MANAGEMENT_CYCLE,
    UNKNOWN_TRANSFER_EMPLOYEE, ROOT_MOVE_FORBIDDEN, ALREADY_REPORTS_TO_MANAGER
};

struct ValidationError {
    ErrorCode   code = ErrorCode::NONE;
    std::string message;
    bool ok() const { return code == ErrorCode::NONE; }
};
```

The requirement fixes the order: bad field/count → duplicate ID → root count → self/unknown manager → cycle. **That's not a preference — each check needs the previous one to have passed:**

- Can't check duplicates until IDs are well-formed.
- Can't count who has no manager until IDs are unique.
- Can't check that `manager_id = "MGR_Z"` points at a real person until the ID list is final.
- Can't look for loops until every arrow points at somebody real.

So it's a pipeline. First failure wins, stop immediately:

```cpp
ValidationError validate(const std::vector<Employee>& employees) {
    using Check = ValidationError (*)(const std::vector<Employee>&);
    static const Check checks[] = {
        checkCountAndFields,      // step 1
        checkDuplicateIds,        // step 2
        checkRootCount,           // step 3
        checkManagerReferences,   // step 4  (self AND unknown together)
        checkSingleConnectedTree  // step 5
    };
    for (Check c : checks) {
        ValidationError err = c(employees);
        if (!err.ok()) return err;      // first failure wins
    }
    return {};
}
```

### 4.2 The five checks

**Step 1 — count and fields → `INVALID_EMPLOYEE`**

```cpp
static bool validId(const std::string& s) {
    if (s.empty() || s.size() > 16) return false;
    if (!(s[0] >= 'A' && s[0] <= 'Z')) return false;          // must START with A-Z
    for (size_t i = 1; i < s.size(); ++i) {
        char c = s[i];
        bool okChar = (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                   || c == '_' || c == '-';
        if (!okChar) return false;
    }
    return true;
}

static std::string trim(const std::string& s) {
    size_t b = s.find_first_not_of(" \t\n\r");
    if (b == std::string::npos) return "";
    size_t e = s.find_last_not_of(" \t\n\r");
    return s.substr(b, e - b + 1);
}

ValidationError checkCountAndFields(const std::vector<Employee>& es) {
    if (es.empty() || es.size() > 30)
        return {ErrorCode::INVALID_EMPLOYEE,
                "employee count " + std::to_string(es.size()) + " outside 1..30"};

    for (size_t i = 0; i < es.size(); ++i) {          // SOURCE ORDER
        const Employee& e = es[i];
        std::string at = " at record " + std::to_string(i);
        if (!validId(e.employee_id))
            return {ErrorCode::INVALID_EMPLOYEE, "malformed employee_id '" + e.employee_id + "'" + at};
        if (trim(e.name).empty())
            return {ErrorCode::INVALID_EMPLOYEE, "empty name" + at};
        if (trim(e.role).empty())
            return {ErrorCode::INVALID_EMPLOYEE, "empty role" + at};
        if (e.monthly_salary < 1 || e.monthly_salary > 1000000)
            return {ErrorCode::INVALID_EMPLOYEE,
                    "salary " + std::to_string(e.monthly_salary) + " outside 1..1000000" + at};
    }
    return {};
}
```

> **Assumption, recorded deliberately.** The spec says reject if "the employee count or a field is invalid" but gives no distinct code for a bad count. We use `INVALID_EMPLOYEE` with a message naming the count. Written down so it's a visible decision, not a silent one.

**Step 2 — duplicates → `DUPLICATE_EMPLOYEE_ID`**

```cpp
ValidationError checkDuplicateIds(const std::vector<Employee>& es) {
    std::unordered_map<std::string, size_t> firstSeen;
    for (size_t i = 0; i < es.size(); ++i) {          // SOURCE ORDER
        auto it = firstSeen.find(es[i].employee_id);
        if (it != firstSeen.end())
            return {ErrorCode::DUPLICATE_EMPLOYEE_ID,
                    "employee_id '" + es[i].employee_id + "' appears at records "
                    + std::to_string(it->second) + " and " + std::to_string(i)};
        firstSeen[es[i].employee_id] = i;
    }
    return {};
}
```

**Step 3 — root count → `INVALID_ROOT_COUNT`**

```cpp
ValidationError checkRootCount(const std::vector<Employee>& es) {
    std::vector<std::string> roots;
    for (const Employee& e : es)
        if (!e.manager_id.has_value()) roots.push_back(e.employee_id);

    if (roots.size() != 1) {
        std::string ids;
        for (const std::string& r : roots) ids += (ids.empty() ? "" : ", ") + r;
        return {ErrorCode::INVALID_ROOT_COUNT,
                "expected exactly 1 department head, found "
                + std::to_string(roots.size()) + (ids.empty() ? "" : " [" + ids + "]")};
    }
    return {};
}
```

Zero roots means no HOD. Two or more means two separate org charts, not one department. Note a self-managed person is **not** a root (their `manager_id` isn't null), so this check is unaffected by step 4.

**Step 4 — manager references → `SELF_MANAGER` / `UNKNOWN_MANAGER`**

> **This one has a trap, and it's the most likely thing to get wrong.**
>
> These two codes are **one category** in the precedence list, broken by source order — *not* two categories in sequence.
>
> - Record 3 has an unknown manager, record 5 manages themselves → report **record 3's `UNKNOWN_MANAGER`**.
> - Record 2 manages themselves, record 4 has an unknown manager → report **record 2's `SELF_MANAGER`**.
>
> So: **one loop**, checking both conditions per record, returning whichever it meets first. The natural mistake is writing two separate loops — that makes one code always beat the other regardless of position, and a precedence test will catch it.

```cpp
ValidationError checkManagerReferences(const std::vector<Employee>& es) {
    std::unordered_set<std::string> ids;
    for (const Employee& e : es) ids.insert(e.employee_id);

    for (size_t i = 0; i < es.size(); ++i) {      // ONE loop, SOURCE ORDER
        const Employee& e = es[i];
        if (!e.manager_id.has_value()) continue;

        // both conditions tested on the SAME record before moving on
        if (*e.manager_id == e.employee_id)
            return {ErrorCode::SELF_MANAGER,
                    "'" + e.employee_id + "' manages themself at record " + std::to_string(i)};

        if (ids.find(*e.manager_id) == ids.end())
            return {ErrorCode::UNKNOWN_MANAGER,
                    "'" + e.employee_id + "' at record " + std::to_string(i)
                    + " references unknown manager '" + *e.manager_id + "'"};
    }
    return {};
}
```

Managing yourself is technically a loop of length 1, but it's caught here with its own code, so it never reaches step 5.

**Step 5 — one connected tree → `MANAGEMENT_CYCLE`** — next section.

### 4.3 Finding loops without writing a loop-detector

**The intuition.** Every employee writes down exactly one name: their manager. The HOD writes "nobody." Picture everyone holding an arrow pointing at their boss.

Start at *any* employee and follow arrows upward. At each step there's exactly one place to go — no choices, no dead ends, because step 4 proved every name refers to a real person.

The walk can only end two ways:

- **You reach the HOD.** They have no arrow. You stop. ✓
- **You never reach the HOD.** But the company is finite, so you can't walk forever without repeating someone. The moment you revisit someone, **you're going in circles.** ✗

**There is no third outcome.**

**Now flip it.** "Can I walk *up* from X to the HOD?" and "can I walk *down* from the HOD to X?" are the same question — same arrows, read the other way.

So: **start at the HOD, walk down, mark everyone you reach.** Anyone you *miss* couldn't walk up to the HOD — which by the argument above means they're in a loop or hanging off one.

```cpp
ValidationError checkSingleConnectedTree(const std::vector<Employee>& es) {
    Indexes ix = buildIndexes(es);

    // walk DOWN from the root, marking everyone reachable
    std::unordered_set<std::string> visited;
    std::vector<std::string> stack{ix.rootId};
    while (!stack.empty()) {
        std::string cur = stack.back(); stack.pop_back();
        if (!visited.insert(cur).second) continue;
        auto it = ix.childrenOf.find(cur);
        if (it != ix.childrenOf.end())
            for (const std::string& c : it->second) stack.push_back(c);
    }

    if (visited.size() == es.size()) return {};        // <-- valid tree. done.

    // someone was unreachable => a cycle exists. Now go NAME it (§4.4).
    for (const Employee& e : es)
        if (visited.find(e.employee_id) == visited.end())
            return {ErrorCode::MANAGEMENT_CYCLE,
                    "reporting cycle: " + describeCycle(ix, e.employee_id)};

    return {};   // unreachable
}
```

**That's it. One walk.** You do not write a separate cycle-detector with colour-marking or recursion stacks. The traversal you needed anyway answers *both* "is everyone connected?" and "are there loops?" simultaneously.

> **The formal version, if you prefer it stated that way.** Each non-root contributes exactly one edge, so there are `n` nodes and `n − 1` edges. A graph with `n` nodes and `n − 1` edges is a tree if and only if it's connected. The arrow-walking argument is the same fact without the counting.

### 4.4 Naming who's in the loop

Counting proves a loop exists but not *who's* in it, and the spec wants a message naming them. So on failure only, one short extra walk:

```cpp
std::string describeCycle(const Indexes& ix, const std::string& start) {
    std::vector<std::string> seen;
    std::unordered_map<std::string, size_t> pos;
    std::string cur = start;

    while (pos.find(cur) == pos.end()) {       // walk UP collecting names
        pos[cur] = seen.size();
        seen.push_back(cur);
        const ManagerId& m = ix.byId.at(cur).manager_id;
        if (!m.has_value()) return "";         // can't happen on this path
        cur = *m;
    }

    // `cur` is the repeat -> the circle closes there
    std::string out;
    for (size_t i = pos[cur]; i < seen.size(); ++i)
        out += seen[i] + " -> ";
    return out + cur;
}
```

You walk up collecting names until you hit one you already have. That repeat is where the circle closes, so everything from there onward **is** the circle.

Example: `A -> B -> C -> D -> B`. You collect `[A, B, C, D]`, then hit `B` again. `B` is at index 1, so the cycle is `B -> C -> D -> B`. `A` was just the tail leading into it.

`O(depth)`, and it only runs when something is already broken.

### 4.5 A failed load wipes everything

```cpp
struct AppState {
    std::vector<Employee> employees;
    std::unordered_map<std::string, Rollup> rollups;
    Indexes ix;
    ValidationError error;          // set => everything above is empty
};

AppState load(const std::vector<Employee>& records) {
    ValidationError err = validate(records);
    if (!err.ok()) return AppState{ {}, {}, {}, err };   // <-- whole new state
    AppState s;
    s.employees = records;
    s.ix        = buildIndexes(s.employees);
    s.rollups   = computeRollups(s.employees, s.ix);
    return s;
}
```

Note it **returns a whole new `AppState`** rather than editing an existing one. So there's no "clear the old stuff" code you could forget to write — the old state simply isn't carried forward. No partial tree, no stale totals from a department that loaded fine earlier.

---

## 5. Computing the totals

### 5.1 Bottom-up, because there's no other way

```
team_headcount(e) = 1 + sum of children's team_headcount
team_payroll(e)   = own salary + sum of children's team_payroll
```

**Why the order is forced:** you can't total MGR_A until you know LEAD_A's total, and you can't know LEAD_A's until you know E_X's. Children first, always. That's what **post-order** means: do all the children, *then* do yourself.

```cpp
Rollup rollupRec(const std::string& id,
                 const Indexes& ix,
                 std::unordered_map<std::string, Rollup>& out) {
    Rollup r;
    r.headcount = 1;                                   // start with YOURSELF
    r.payroll   = ix.byId.at(id).monthly_salary;

    auto it = ix.childrenOf.find(id);
    if (it != ix.childrenOf.end()) {
        for (const std::string& c : it->second) {
            Rollup cr = rollupRec(c, ix, out);         // finish the child FIRST
            r.headcount += cr.headcount;
            r.payroll   += cr.payroll;
        }
    }
    out[id] = r;
    return r;
}

std::unordered_map<std::string, Rollup>
computeRollups(const std::vector<Employee>& employees, const Indexes& ix) {
    std::unordered_map<std::string, Rollup> out;
    rollupRec(ix.rootId, ix, out);
    assertInvariants(employees, out, ix.rootId);       // I1 + I2, every time
    return out;
}
```

**Trace it on the example.** `rollupRec(HOD)` calls `rollupRec(MGR_A)`, which calls `rollupRec(LEAD_A)`, which calls `rollupRec(E_X)`.
- E_X is a leaf → `(1, 40000)`
- LEAD_A → `(1+1, 60000+40000)` = `(2, 100000)`
- E_Y is a leaf → `(1, 45000)`
- MGR_A → `(1+2+1, 80000+100000+45000)` = `(4, 225000)`
- MGR_B is a leaf → `(1, 75000)`
- HOD → `(1+4+1, 150000+225000+75000)` = `(6, 450000)` ✓

Recursion is safe — depth can't exceed 30.

### 5.2 The no-recursion version (reference only)

```cpp
// BFS gives an order where parents ALWAYS come before children.
// Read it BACKWARDS and every child is finished before its parent is touched.
std::unordered_map<std::string, Rollup>
computeRollupsIterative(const std::vector<Employee>& employees, const Indexes& ix) {
    std::vector<std::string> order;
    for (size_t head = 0; ; ) {
        if (order.empty()) order.push_back(ix.rootId);
        if (head >= order.size()) break;
        std::string cur = order[head++];
        auto it = ix.childrenOf.find(cur);
        if (it != ix.childrenOf.end())
            for (const std::string& c : it->second) order.push_back(c);
    }

    std::unordered_map<std::string, Rollup> r;
    for (const Employee& e : employees) r[e.employee_id] = Rollup{0, 0};

    for (size_t i = order.size(); i-- > 0; ) {        // <-- REVERSED
        const std::string& id = order[i];
        r[id].headcount += 1;
        r[id].payroll   += ix.byId.at(id).monthly_salary;
        const ManagerId& m = ix.byId.at(id).manager_id;
        if (m.has_value()) {
            r[*m].headcount += r[id].headcount;       // push totals up to the boss
            r[*m].payroll   += r[id].payroll;
        }
    }
    return r;
}
```

**Decision: ship §5.1.** It reads better. §5.2 is what you'd reach for if the tree could be thousands deep and blow the call stack.

### 5.3 Inspecting someone changes nothing

```cpp
struct Inspection {
    std::string role;
    long long   salary;
    size_t      directReports;
    Rollup      team;
};

Inspection inspect(const AppState& s, const std::string& id) {
    const Employee& e = s.ix.byId.at(id);
    auto it = s.ix.childrenOf.find(id);
    return { e.role, e.monthly_salary,
             it == s.ix.childrenOf.end() ? 0 : it->second.size(),
             s.rollups.at(id) };
}
```

Note the `const AppState&` and the absence of any traversal. The requirement that inspection must not change the tree is satisfied by there being nothing to change — the type system enforces it.

---

## 6. The transfer

### 6.1 Shape

```cpp
struct TransferResult {
    bool                     ok = false;
    ValidationError          error;          // set when ok == false
    AppState                 state;          // the NEW state, when ok == true
    std::string              oldManagerId;
    std::string              newManagerId;
    Rollup                   movedSubtree;
    std::vector<std::string> changedRollupIds;   // in SOURCE ORDER
    std::unordered_map<std::string, Rollup> before, after;
};
```

All checks run **before** anything is written.

### 6.2 The five rejection checks, in this exact order

| Order | Code | Reject when |
|---|---|---|
| 1 | `UNKNOWN_TRANSFER_EMPLOYEE` | either ID doesn't exist |
| 2 | `ROOT_MOVE_FORBIDDEN` | you're moving the HOD |
| 3 | `SELF_MANAGER` | both IDs are the same person |
| 4 | `ALREADY_REPORTS_TO_MANAGER` | they already report to that manager |
| 5 | `MANAGEMENT_CYCLE` | the new manager is somewhere *below* this person |

**Check 5 in plain terms:** you can't make LEAD_A report to E_X, because E_X works for LEAD_A. LEAD_A would end up being their own boss's boss — a loop.

> **A consequence to know.** Submit "move the HOD to report to the HOD" and you get `ROOT_MOVE_FORBIDDEN`, not `SELF_MANAGER`, because check 2 runs before check 3. That's observable behaviour, so it gets a test — otherwise someone later "fixes" it into a bug.

Checks 2 and 3 also make check 5 simpler: by the time you reach it, you know the person isn't the root and isn't the same as the target.

### 6.3 Check 5: walk up, not down

Two ways to ask "is the new manager inside this person's team?":

- **Search downward:** walk everyone under LEAD_A looking for the target. Up to 30 people.
- **Walk upward:** start at the target, follow manager arrows up, look for LEAD_A. At most `depth` people — usually 2 or 3.

Take the upward walk:

```cpp
bool isAncestor(const Indexes& ix,
                const std::string& boss,      // "is `boss` somewhere ABOVE..."
                const std::string& person) {  // "...`person`?"
    std::string cur = person;
    while (true) {
        if (cur == boss) return true;
        const ManagerId& m = ix.byId.at(cur).manager_id;
        if (!m.has_value()) return false;     // reached the HOD, never found boss
        cur = *m;
    }
}
```

**Read it on the example.**
- Test "move LEAD_A under E_X": walk up from E_X → LEAD_A. **Found → reject.**
- Test "move LEAD_A under MGR_B": walk up from MGR_B → HOD → stop. **Never found → allow.** ✓

**Nice detail:** this loop is guaranteed to terminate *because §4.3 already proved there are no cycles.* Validating the tree once buys you a cheap, safe query forever after.

### 6.4 Doing the move

```cpp
TransferResult applyTransfer(const AppState& s,
                             const std::string& employeeId,
                             const std::string& newManagerId) {
    TransferResult tr;

    // ---- check 1 ----
    if (!s.ix.byId.count(employeeId) || !s.ix.byId.count(newManagerId)) {
        tr.error = {ErrorCode::UNKNOWN_TRANSFER_EMPLOYEE, "unknown employee or manager id"};
        return tr;                                  // state NEVER touched
    }
    // ---- check 2 ----
    if (employeeId == s.ix.rootId) {
        tr.error = {ErrorCode::ROOT_MOVE_FORBIDDEN,
                    "cannot move the department head '" + employeeId + "'"};
        return tr;
    }
    // ---- check 3 ----
    if (employeeId == newManagerId) {
        tr.error = {ErrorCode::SELF_MANAGER, "'" + employeeId + "' cannot manage themself"};
        return tr;
    }
    // ---- check 4 ----
    if (*s.ix.byId.at(employeeId).manager_id == newManagerId) {
        tr.error = {ErrorCode::ALREADY_REPORTS_TO_MANAGER,
                    "'" + employeeId + "' already reports to '" + newManagerId + "'"};
        return tr;
    }
    // ---- check 5 ----
    if (isAncestor(s.ix, employeeId, newManagerId)) {
        tr.error = {ErrorCode::MANAGEMENT_CYCLE,
                    "'" + newManagerId + "' is inside '" + employeeId + "' team"};
        return tr;
    }

    // ===== every check passed. ONLY NOW do we build a new state. =====
    tr.oldManagerId = *s.ix.byId.at(employeeId).manager_id;
    tr.newManagerId = newManagerId;
    tr.movedSubtree = s.rollups.at(employeeId);
    tr.before       = s.rollups;

    std::vector<Employee> next = s.employees;       // copy
    for (Employee& e : next)
        if (e.employee_id == employeeId) { e.manager_id = newManagerId; break; }
                                                    // ^ the ENTIRE move

    AppState ns;
    ns.employees = next;
    ns.ix        = buildIndexes(ns.employees);      // report lists rebuilt in source order
    ns.rollups   = computeRollups(ns.employees, ns.ix);

    tr.after = ns.rollups;
    for (const Employee& e : next)                  // <-- SOURCE ORDER, free
        if (tr.before.at(e.employee_id).headcount != tr.after.at(e.employee_id).headcount ||
            tr.before.at(e.employee_id).payroll   != tr.after.at(e.employee_id).payroll)
            tr.changedRollupIds.push_back(e.employee_id);

    tr.state = ns;
    tr.ok    = true;
    return tr;
}
```

**Notice the shape.** Five early returns, each leaving `s` completely untouched. Then one block that builds an entirely new state. There is no path where a rejection modifies anything, because a rejection returns before the first write.

Both affected managers' report lists come out correct and in source order for free, because `buildIndexes` rebuilds by a source-order pass. Nobody else's relative order shifts. Nothing is spliced anywhere.

---

## 7. Which totals changed

### 7.1 What we ship: compare before and after

That's the loop at the end of `applyTransfer` above. Save the old numbers, compute the new numbers, list who differs. `O(n)`, impossible to get wrong, and it's literally how the requirement defines the field.

Looping over `next` (our source-ordered vector) rather than over the map gives the required ordering with **no sorting**. That's the third time the §2 layout pays off.

### 7.2 Why only those people change — the fork point

You don't need this to build the app. You need it to *explain* the app, and it turns one confusing line in the requirements into something obvious.

**Start here:** your team payroll is just "the total salary of everyone under me, including me." So:

> **Your numbers change if and only if the set of people under you changed.**

LEAD_A's team (2 people, 100000) walks out of MGR_A's org and into MGR_B's. Ask each manager one question: *"were they under me before, and are they under me after?"*

| Manager | Under me before? | Under me after? | Changed? |
|---|---|---|---|
| MGR_A | yes | no | **yes** — lost them |
| MGR_B | no | yes | **yes** — gained them |
| HOD | yes | yes | **no** — had them all along |
| E_Y | no | no | **no** — never involved |

**Only yes/no and no/yes change. yes/yes and no/no don't.**

When *is* a team under you? Exactly when you're the old boss, or anywhere above the old boss. So:

- "under me before" = you're on the chain **MGR_A → HOD**
- "under me after" = you're on the chain **MGR_B → HOD**

Both chains run to the top, so they eventually merge. Call the merge point the **fork point** — the first manager standing above *both* the old boss and the new boss. Here that's HOD.

```
                HOD          <- fork point: on BOTH chains -> no change
               /   \
          MGR_A     MGR_B    <- each on only ONE chain -> both change
```

**From the fork upward you're on both chains → yes/yes → nothing changes.**
**Below the fork you're on exactly one chain → you gained or lost them → you change.**

So the answer is: *everyone between the old boss and the fork, plus everyone between the new boss and the fork.* Here `{MGR_A}` and `{MGR_B}`. The fork point and everything above it is untouched.

(The formal name for the fork point is the **lowest common ancestor**; the changed set is the symmetric difference of the two root-paths. But "fork point" is the same thing in words you can say out loud in a demo.)

**This explains the requirement line that otherwise looks arbitrary:**

> *"Do not label an unchanged common ancestor as financially affected merely because it remains above both branches."*

**That sentence is describing the fork point.** HOD sits above both branches, so it's tempting to mark it affected — but its numbers are identical, because the people never left.

**Two consequences that match the requirements exactly:**

- **The moved person's own numbers don't change.** LEAD_A is still 2 / 100000 — their team came along. That's why the spec says the moved employee "may be shown separately even when their own rollup values did not change." They get a *moved* highlight, not a *changed* highlight. **Two distinct visual states, deliberately.**
- **The HOD never changes on any internal move.** There's always a fork point at or below the root, so the root is never in the changed list. Hence the acceptance criterion that the department head's totals stay put.

**Why the §7.1 comparison can't miss anyone:** if the set of people under you changed, it changed by **at least one person** — the moved team always contains at least the moved person. So headcount always moves. There's no way for a change to hide. (Payroll moves too, since every salary is ≥ 1, but headcount alone already guarantees detection.)

**A second worked check, different shape.** Move E_Y from MGR_A up to HOD directly. Old-boss chain: MGR_A → HOD. New-boss chain: HOD. Fork = HOD. Changed = `{MGR_A}` only — MGR_A drops to 3 / 180000, HOD stays 6 / 450000 because it still has everyone. Correct: when the new boss is *already above* the old boss, one side of the fork is empty.

### 7.3 Use the fork-point rule in tests, not in the app

```cpp
// TEST-ONLY. A second, independent way to get the same answer.
std::vector<std::string> predictChangedByForkPoint(
        const Indexes& ix, const std::string& oldBoss, const std::string& newBoss) {

    auto chainToRoot = [&](std::string cur) {
        std::vector<std::string> chain;
        while (true) {
            chain.push_back(cur);
            const ManagerId& m = ix.byId.at(cur).manager_id;
            if (!m.has_value()) break;
            cur = *m;
        }
        return chain;
    };

    std::vector<std::string> a = chainToRoot(oldBoss), b = chainToRoot(newBoss);
    std::unordered_set<std::string> inB(b.begin(), b.end());

    std::string fork;                                  // first shared node
    for (const std::string& x : a) if (inB.count(x)) { fork = x; break; }

    std::vector<std::string> changed;                  // both sides, below the fork
    for (const std::string& x : a) { if (x == fork) break; changed.push_back(x); }
    for (const std::string& x : b) { if (x == fork) break; changed.push_back(x); }
    return changed;                                    // caller sorts to source order
}
```

The fork-point method is faster (`O(depth)` vs `O(n)`), but at 30 records that saving is worth nothing, and it's the kind of reasoning that goes subtly wrong in edge cases.

So: **the app** uses §7.1 (compare everything — boring, unbreakable). **The tests** assert §7.1's answer matches this function's prediction.

Two completely different methods agreeing is far stronger evidence than either alone — and it's exactly the "work it out independently, don't just trust the code" discipline the problem statement keeps demanding.

---

## 8. Cost of everything

| Operation | Cost | On 30 records |
|---|---|---|
| field / duplicate / root checks | `O(n)` | instant |
| tree validation (§4.3) | `O(n)` | instant |
| naming a cycle (failure only) | `O(depth)` | instant |
| rebuilding indexes | `O(n)` | instant |
| computing all totals | `O(n)` | instant |
| transfer validation (§6.3) | `O(depth)` | instant |
| transfer + recompute + diff | `O(n)` | instant |

Everything is linear. **`n ≤ 30`, so nothing here needs optimising.**

That's why we twice chose the obviously-correct version over the clever one — §5.1 recomputes all totals instead of patching a few, and §7.1 compares all values instead of deducing which should have changed. Knowing when *not* to optimise is a real engineering judgement, and worth saying out loud when you present this.

---

## 9. Error codes

**Load:** `INVALID_EMPLOYEE`, `DUPLICATE_EMPLOYEE_ID`, `INVALID_ROOT_COUNT`, `UNKNOWN_MANAGER`, `SELF_MANAGER`, `MANAGEMENT_CYCLE`

**Transfer:** `UNKNOWN_TRANSFER_EMPLOYEE`, `ROOT_MOVE_FORBIDDEN`, `SELF_MANAGER`, `ALREADY_REPORTS_TO_MANAGER`, `MANAGEMENT_CYCLE`

One `enum class` shared by both (§4.1) so tests and UI reference the same symbols — never a typed string literal in two places. `SELF_MANAGER` and `MANAGEMENT_CYCLE` intentionally appear in both lists.

---

## 10. File layout (for the shipped JS/TS version)

```
src/
  engine/          <- pure logic. no DOM, no framework, no file reading.
    validate       §4
    rollup         §5
    transfer       §6, §7
    codes          §9
  ui/              <- displays what the engine returns. computes nothing.
  data/
    department.*   <- the 12-employee fixture (real input)
tests/
  fixtures/
    expected.*     <- hand-worked answers. TESTS ONLY. never imported by src/.
```

**Two rules that matter:**

1. **`engine/` imports nothing from `ui/`.** The engine is testable with no browser at all. That separation is itself the evidence the app computes its own results.
2. **The expected answers are quarantined.** The problem says the app must calculate its own results and must **not** read the documented answers as input. Don't leave that on trust — **write a test that scans `src/` for any import of the expected fixture and fails if it finds one.** Five lines, and it's an obvious thing for an evaluator to probe.

---

## 11. Test list

| Area | What it asserts |
|---|---|
| leaf totals | headcount 1, payroll == own salary |
| multi-level totals | every person matches the hand-worked sheet |
| root invariants | I1 and I2 |
| one-person department | n=1, headcount 1, payroll == salary |
| moved team intact | subtree under the moved person identical afterwards |
| valid transfer | post-move totals match the hand-worked sheet |
| changed list | §7.1 diff == §7.3 fork-point prediction == documented IDs |
| sibling order | reports in source order, before and after |
| cycle rejection | descendant-as-manager → `MANAGEMENT_CYCLE`, **both** before and after the valid transfer |
| root protection | moving the HOD → `ROOT_MOVE_FORBIDDEN` |
| rejection is safe | after any rejection, state deep-equals the pre-attempt state |
| bad load — duplicate ID | `DUPLICATE_EMPLOYEE_ID` |
| bad load — unknown manager | `UNKNOWN_MANAGER` |
| bad load — cycle | `MANAGEMENT_CYCLE`, message names the members |
| error precedence | multi-error input follows §4.1; self/unknown broken by source order (§4.2 step 4) |
| bad load clears state | a failed load after a good one leaves no stale tree or totals |
| reset | restores records, totals, default selection, cleared highlights |
| repeatability | reset → same transfer again → identical result |
| fixture quarantine | no `src/` file imports the expected answers |

---

## 12. Running it

The complete program is in [`reference/rollup.cpp`](reference/rollup.cpp).

```bash
c++ -std=c++17 -O2 -o /tmp/rollup reference/rollup.cpp && /tmp/rollup
```

It loads the §0 example, prints every total, applies the LEAD_A → MGR_B transfer, prints the changed list, cross-checks it against the fork-point prediction, and exercises each rejection path. Every number it prints is checked against a second, independently computed value, so a clean run ends with `ALL CHECKS PASSED` and a non-zero exit code means something disagreed.

**Use it as a calculator.** When you design the real 12-person org, put the records into `reference/rollup.cpp` and it will produce the totals — giving you a way to check your hand-worked sheet against something that isn't the app you're grading.

---

## 13. Still to decide

| # | Decision | Status |
|---|---|---|
| D1 | Technology stack for the shipped app | **open** — the engine is framework-free, so this doesn't affect §1–§9 |
| D2 | Side-by-side comparison drawer (optional credit) | **open** — cheap, we already keep the original for Reset |
| D3 | The 12-employee fixture + hand-worked totals | **next up** — needs one HOD, ≥2 branches, ≥3 managers, ≥1 movable non-leaf lead, ≥1 person 3+ levels down, distinct salaries |
| D4 | How to draw the tree | **leaning:** hand-written recursive render with CSS lines, no graph library |

---

## 14. Suggested order of work

Build the engine before the UI. It's where correctness lives, it's testable without a browser, and if time runs short a well-tested engine with a plain UI scores far better than a polished UI with untested logic.

| Order | Do this | Done when |
|---|---|---|
| 1 | **D3** — design the 12-person org, work totals out by hand | numbers computed twice independently; I1 and I2 check out on paper |
| 2 | Engine: validation (§4) + totals (§5) | hand-worked numbers reproduced; bad-load tests pass |
| 3 | Engine: transfer (§6) + changed list (§7) | valid move, both rejections, rejection-safety tests pass |
| 4 | UI: tree, table, detail panel, total cards | load in one action, click anyone, see their numbers |
| 5 | UI: transfer controls, impact panel, highlights, reset | full acceptance walkthrough works live |
| 6 | Write-up: prompt log, plan-vs-actual, screenshots; drawer if time | demo rehearsed start to finish |

**Checkpoint after step 3:** every "Required" acceptance criterion is already *provable* — the UI just has to display it. If you're behind schedule, that's where you simplify the UI, never the engine.
# PS4-Departmental-Reorg-payroll-Rollup-Tracker

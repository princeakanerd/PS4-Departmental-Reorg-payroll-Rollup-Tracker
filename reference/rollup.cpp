// Reference implementation of the Departmental Reorg Payroll Rollup Tracker engine.
// Mirrors README.md section by section. Learning aid + independent calculator.
//   c++ -std=c++17 -O2 -o /tmp/rollup reference/rollup.cpp && /tmp/rollup

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <optional>
#include <iostream>
#include <cassert>

// ---------------------------------------------------------------- §1 types
using ManagerId = std::optional<std::string>;

struct Employee {
    std::string employee_id;
    std::string name;
    std::string role;
    long long   monthly_salary;
    ManagerId   manager_id;
};

struct Rollup {
    long long headcount = 0;
    long long payroll   = 0;
    bool operator==(const Rollup& o) const {
        return headcount == o.headcount && payroll == o.payroll;
    }
};

// ------------------------------------------------------------ §2.2 indexes
// NOTE: byId stores a COPY, not a pointer. An index that points into a vector
// becomes dangling the moment that vector is copied or destroyed -- exactly the
// "derived data outliving its source" bug class S2.3 warns about. Copying 30
// small structs costs nothing and makes the index safe to store and move.
struct Indexes {
    std::unordered_map<std::string, Employee>                 byId;
    std::unordered_map<std::string, std::vector<std::string>> childrenOf;
    std::string                                               rootId;
};

Indexes buildIndexes(const std::vector<Employee>& employees) {
    Indexes ix;
    for (const Employee& e : employees) ix.byId[e.employee_id] = e;   // copy
    for (const Employee& e : employees) {          // <-- SOURCE ORDER
        if (e.manager_id.has_value())
            ix.childrenOf[*e.manager_id].push_back(e.employee_id);  // push_back keeps it
        else
            ix.rootId = e.employee_id;
    }
    return ix;
}

// ------------------------------------------------------------- §4.1 errors
enum class ErrorCode {
    NONE,
    INVALID_EMPLOYEE, DUPLICATE_EMPLOYEE_ID, INVALID_ROOT_COUNT,
    UNKNOWN_MANAGER, SELF_MANAGER, MANAGEMENT_CYCLE,
    UNKNOWN_TRANSFER_EMPLOYEE, ROOT_MOVE_FORBIDDEN, ALREADY_REPORTS_TO_MANAGER
};

const char* codeName(ErrorCode c) {
    switch (c) {
        case ErrorCode::NONE:                      return "NONE";
        case ErrorCode::INVALID_EMPLOYEE:          return "INVALID_EMPLOYEE";
        case ErrorCode::DUPLICATE_EMPLOYEE_ID:     return "DUPLICATE_EMPLOYEE_ID";
        case ErrorCode::INVALID_ROOT_COUNT:        return "INVALID_ROOT_COUNT";
        case ErrorCode::UNKNOWN_MANAGER:           return "UNKNOWN_MANAGER";
        case ErrorCode::SELF_MANAGER:              return "SELF_MANAGER";
        case ErrorCode::MANAGEMENT_CYCLE:          return "MANAGEMENT_CYCLE";
        case ErrorCode::UNKNOWN_TRANSFER_EMPLOYEE: return "UNKNOWN_TRANSFER_EMPLOYEE";
        case ErrorCode::ROOT_MOVE_FORBIDDEN:       return "ROOT_MOVE_FORBIDDEN";
        case ErrorCode::ALREADY_REPORTS_TO_MANAGER:return "ALREADY_REPORTS_TO_MANAGER";
    }
    return "?";
}

struct ValidationError {
    ErrorCode   code = ErrorCode::NONE;
    std::string message;
    bool ok() const { return code == ErrorCode::NONE; }
};

// -------------------------------------------------------- §4.2 step 1
static bool validId(const std::string& s) {
    if (s.empty() || s.size() > 16) return false;
    if (!(s[0] >= 'A' && s[0] <= 'Z')) return false;
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

    for (size_t i = 0; i < es.size(); ++i) {
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

// -------------------------------------------------------- §4.2 step 2
ValidationError checkDuplicateIds(const std::vector<Employee>& es) {
    std::unordered_map<std::string, size_t> firstSeen;
    for (size_t i = 0; i < es.size(); ++i) {
        auto it = firstSeen.find(es[i].employee_id);
        if (it != firstSeen.end())
            return {ErrorCode::DUPLICATE_EMPLOYEE_ID,
                    "employee_id '" + es[i].employee_id + "' appears at records "
                    + std::to_string(it->second) + " and " + std::to_string(i)};
        firstSeen[es[i].employee_id] = i;
    }
    return {};
}

// -------------------------------------------------------- §4.2 step 3
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

// -------------------------------------------------------- §4.2 step 4
// ONE loop. Both conditions tested per record. Source order breaks the tie.
ValidationError checkManagerReferences(const std::vector<Employee>& es) {
    std::unordered_set<std::string> ids;
    for (const Employee& e : es) ids.insert(e.employee_id);

    for (size_t i = 0; i < es.size(); ++i) {
        const Employee& e = es[i];
        if (!e.manager_id.has_value()) continue;

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

// -------------------------------------------------------- §4.4 name the cycle
std::string describeCycle(const Indexes& ix, const std::string& start) {
    std::vector<std::string> seen;
    std::unordered_map<std::string, size_t> pos;
    std::string cur = start;

    while (pos.find(cur) == pos.end()) {
        pos[cur] = seen.size();
        seen.push_back(cur);
        const ManagerId& m = ix.byId.at(cur).manager_id;
        if (!m.has_value()) return "";
        cur = *m;
    }
    std::string out;
    for (size_t i = pos[cur]; i < seen.size(); ++i) out += seen[i] + " -> ";
    return out + cur;
}

// -------------------------------------------------------- §4.3 step 5
// Walk DOWN from the root. Anyone unreached couldn't walk UP to the root,
// which (every arrow being valid, company being finite) means a cycle.
ValidationError checkSingleConnectedTree(const std::vector<Employee>& es) {
    Indexes ix = buildIndexes(es);

    std::unordered_set<std::string> visited;
    std::vector<std::string> stack{ix.rootId};
    while (!stack.empty()) {
        std::string cur = stack.back(); stack.pop_back();
        if (!visited.insert(cur).second) continue;
        auto it = ix.childrenOf.find(cur);
        if (it != ix.childrenOf.end())
            for (const std::string& c : it->second) stack.push_back(c);
    }

    if (visited.size() == es.size()) return {};        // valid tree

    for (const Employee& e : es)
        if (visited.find(e.employee_id) == visited.end())
            return {ErrorCode::MANAGEMENT_CYCLE,
                    "reporting cycle: " + describeCycle(ix, e.employee_id)};
    return {};
}

// -------------------------------------------------------- §4.1 the pipeline
ValidationError validate(const std::vector<Employee>& employees) {
    using Check = ValidationError (*)(const std::vector<Employee>&);
    static const Check checks[] = {
        checkCountAndFields, checkDuplicateIds, checkRootCount,
        checkManagerReferences, checkSingleConnectedTree
    };
    for (Check c : checks) {
        ValidationError err = c(employees);
        if (!err.ok()) return err;
    }
    return {};
}

// -------------------------------------------------------- §3 invariants
void assertInvariants(const std::vector<Employee>& employees,
                      const std::unordered_map<std::string, Rollup>& rollups,
                      const std::string& rootId) {
    long long totalSalary = 0;
    for (const Employee& e : employees) totalSalary += e.monthly_salary;
    assert(rollups.at(rootId).headcount == (long long)employees.size());  // I1
    assert(rollups.at(rootId).payroll   == totalSalary);                  // I2
    (void)totalSalary;
}

// -------------------------------------------------------- §5.1 rollups
Rollup rollupRec(const std::string& id, const Indexes& ix,
                 std::unordered_map<std::string, Rollup>& out) {
    Rollup r;
    r.headcount = 1;                                    // start with YOURSELF
    r.payroll   = ix.byId.at(id).monthly_salary;

    auto it = ix.childrenOf.find(id);
    if (it != ix.childrenOf.end())
        for (const std::string& c : it->second) {
            Rollup cr = rollupRec(c, ix, out);          // child FIRST (post-order)
            r.headcount += cr.headcount;
            r.payroll   += cr.payroll;
        }
    out[id] = r;
    return r;
}

std::unordered_map<std::string, Rollup>
computeRollups(const std::vector<Employee>& employees, const Indexes& ix) {
    std::unordered_map<std::string, Rollup> out;
    rollupRec(ix.rootId, ix, out);
    assertInvariants(employees, out, ix.rootId);
    return out;
}

// -------------------------------------------------------- §5.2 iterative (cross-check)
std::unordered_map<std::string, Rollup>
computeRollupsIterative(const std::vector<Employee>& employees, const Indexes& ix) {
    std::vector<std::string> order{ix.rootId};
    for (size_t head = 0; head < order.size(); ++head) {
        auto it = ix.childrenOf.find(order[head]);
        if (it != ix.childrenOf.end())
            for (const std::string& c : it->second) order.push_back(c);
    }
    std::unordered_map<std::string, Rollup> r;
    for (const Employee& e : employees) r[e.employee_id] = Rollup{0, 0};

    for (size_t i = order.size(); i-- > 0; ) {          // REVERSED: children first
        const std::string& id = order[i];
        r[id].headcount += 1;
        r[id].payroll   += ix.byId.at(id).monthly_salary;
        const ManagerId& m = ix.byId.at(id).manager_id;
        if (m.has_value()) {
            r[*m].headcount += r[id].headcount;
            r[*m].payroll   += r[id].payroll;
        }
    }
    return r;
}

// -------------------------------------------------------- §4.5 app state
struct AppState {
    std::vector<Employee>                   employees;
    std::unordered_map<std::string, Rollup> rollups;
    Indexes                                 ix;
    ValidationError                         error;
};

AppState load(const std::vector<Employee>& records) {
    ValidationError err = validate(records);
    if (!err.ok()) { AppState s; s.error = err; return s; }   // whole new state
    AppState s;
    s.employees = records;
    s.ix        = buildIndexes(s.employees);
    s.rollups   = computeRollups(s.employees, s.ix);
    return s;
}

// -------------------------------------------------------- §6.3 ancestry
bool isAncestor(const Indexes& ix, const std::string& boss, const std::string& person) {
    std::string cur = person;
    while (true) {
        if (cur == boss) return true;
        const ManagerId& m = ix.byId.at(cur).manager_id;
        if (!m.has_value()) return false;
        cur = *m;
    }
}

// -------------------------------------------------------- §6, §7 transfer
struct TransferResult {
    bool                     ok = false;
    ValidationError          error;
    AppState                 state;
    std::string              oldManagerId, newManagerId;
    Rollup                   movedSubtree;
    std::vector<std::string> changedRollupIds;
    std::unordered_map<std::string, Rollup> before, after;
};

TransferResult applyTransfer(const AppState& s,
                             const std::string& employeeId,
                             const std::string& newManagerId) {
    TransferResult tr;

    if (!s.ix.byId.count(employeeId) || !s.ix.byId.count(newManagerId)) {
        tr.error = {ErrorCode::UNKNOWN_TRANSFER_EMPLOYEE, "unknown employee or manager id"};
        return tr;
    }
    if (employeeId == s.ix.rootId) {
        tr.error = {ErrorCode::ROOT_MOVE_FORBIDDEN,
                    "cannot move the department head '" + employeeId + "'"};
        return tr;
    }
    if (employeeId == newManagerId) {
        tr.error = {ErrorCode::SELF_MANAGER, "'" + employeeId + "' cannot manage themself"};
        return tr;
    }
    if (*s.ix.byId.at(employeeId).manager_id == newManagerId) {
        tr.error = {ErrorCode::ALREADY_REPORTS_TO_MANAGER,
                    "'" + employeeId + "' already reports to '" + newManagerId + "'"};
        return tr;
    }
    if (isAncestor(s.ix, employeeId, newManagerId)) {
        tr.error = {ErrorCode::MANAGEMENT_CYCLE,
                    "'" + newManagerId + "' is inside '" + employeeId + "' team"};
        return tr;
    }

    // ===== all checks passed; only now build a new state =====
    tr.oldManagerId = *s.ix.byId.at(employeeId).manager_id;
    tr.newManagerId = newManagerId;
    tr.movedSubtree = s.rollups.at(employeeId);
    tr.before       = s.rollups;

    std::vector<Employee> next = s.employees;
    for (Employee& e : next)
        if (e.employee_id == employeeId) { e.manager_id = newManagerId; break; }

    AppState ns;
    ns.employees = next;
    ns.ix        = buildIndexes(ns.employees);
    ns.rollups   = computeRollups(ns.employees, ns.ix);

    tr.after = ns.rollups;
    for (const Employee& e : next)                       // SOURCE ORDER, free
        if (!(tr.before.at(e.employee_id) == tr.after.at(e.employee_id)))
            tr.changedRollupIds.push_back(e.employee_id);

    tr.state = ns;
    tr.ok    = true;
    return tr;
}

// -------------------------------------------------------- §7.3 fork point (TEST ONLY)
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

    std::string fork;
    for (const std::string& x : a) if (inB.count(x)) { fork = x; break; }

    std::vector<std::string> changed;
    for (const std::string& x : a) { if (x == fork) break; changed.push_back(x); }
    for (const std::string& x : b) { if (x == fork) break; changed.push_back(x); }
    return changed;
}

// ============================================================ demo / self-test
static std::string money(long long v) {
    std::string s = std::to_string(v), out;
    int c = 0;
    for (int i = (int)s.size() - 1; i >= 0; --i) {
        out += s[i];
        if (++c % 3 == 0 && i > 0) out += ',';
    }
    return std::string(out.rbegin(), out.rend());
}

static void printTree(const AppState& s, const std::string& id, int depth) {
    const Employee& e = s.ix.byId.at(id);
    const Rollup& r = s.rollups.at(id);
    for (int i = 0; i < depth; ++i) std::cout << "    ";
    std::cout << (depth ? "|- " : "") << e.employee_id
              << "  (" << e.role << ", " << money(e.monthly_salary) << ")"
              << "   team: " << r.headcount << " / " << money(r.payroll) << "\n";
    auto it = s.ix.childrenOf.find(id);
    if (it != s.ix.childrenOf.end())
        for (const std::string& c : it->second) printTree(s, c, depth + 1);
}

static void expectReject(const AppState& s, const std::string& emp,
                         const std::string& mgr, ErrorCode want) {
    TransferResult tr = applyTransfer(s, emp, mgr);
    std::cout << "  move " << emp << " -> " << mgr << " : "
              << codeName(tr.error.code)
              << (tr.error.code == want ? "  [expected]" : "  [*** WRONG ***]")
              << "\n        " << tr.error.message << "\n";
    assert(!tr.ok && tr.error.code == want);
}

int main() {
    // §0 example. Deliberately NOT in manager-first order, to prove order doesn't matter.
    std::vector<Employee> records = {
        {"HOD",    "Asha Rao",    "Department Head",    150000, std::nullopt},
        {"MGR_A",  "Bhavna Iyer", "Programme Manager",   80000, std::string("HOD")},
        {"MGR_B",  "Chetan Das",  "Laboratory Manager",  75000, std::string("HOD")},
        {"LEAD_A", "Divya Nair",  "Project Lead",        60000, std::string("MGR_A")},
        {"E_X",    "Eshan Roy",   "Developer",           40000, std::string("LEAD_A")},
        {"E_Y",    "Farah Khan",  "Designer",            45000, std::string("MGR_A")},
    };

    std::cout << "=== 1. LOAD + INITIAL ROLLUPS (S5.1) ===\n";
    AppState s0 = load(records);
    assert(s0.error.ok());
    printTree(s0, s0.ix.rootId, 0);

    std::cout << "\n=== 2. CROSS-CHECK: recursive (S5.1) vs iterative (S5.2) ===\n";
    auto alt = computeRollupsIterative(s0.employees, s0.ix);
    for (const Employee& e : s0.employees)
        assert(s0.rollups.at(e.employee_id) == alt.at(e.employee_id));
    std::cout << "  both methods agree on all " << s0.employees.size() << " employees  [ok]\n";
    std::cout << "  I1 root headcount == " << s0.rollups.at("HOD").headcount << "  [ok]\n";
    std::cout << "  I2 root payroll   == " << money(s0.rollups.at("HOD").payroll) << "  [ok]\n";

    std::cout << "\n=== 3. VALID TRANSFER: LEAD_A -> MGR_B (S6.4) ===\n";
    TransferResult tr = applyTransfer(s0, "LEAD_A", "MGR_B");
    assert(tr.ok);
    printTree(tr.state, tr.state.ix.rootId, 0);
    std::cout << "\n  old manager : " << tr.oldManagerId
              << "\n  new manager : " << tr.newManagerId
              << "\n  moved team  : " << tr.movedSubtree.headcount
              << " people / " << money(tr.movedSubtree.payroll) << "\n";

    std::cout << "\n  changed_rollup_ids (S7.1 compare-everything):\n";
    for (const std::string& id : tr.changedRollupIds)
        std::cout << "    " << id
                  << " : " << tr.before.at(id).headcount << " / " << money(tr.before.at(id).payroll)
                  << "  ->  " << tr.after.at(id).headcount << " / " << money(tr.after.at(id).payroll) << "\n";

    std::cout << "\n  fork-point prediction (S7.3, independent method): ";
    auto predicted = predictChangedByForkPoint(s0.ix, tr.oldManagerId, tr.newManagerId);
    std::unordered_set<std::string> pset(predicted.begin(), predicted.end());
    for (const std::string& x : predicted) std::cout << x << " ";
    std::unordered_set<std::string> cset(tr.changedRollupIds.begin(), tr.changedRollupIds.end());
    assert(pset == cset);
    std::cout << "\n  -> the two methods AGREE  [ok]\n";
    std::cout << "  HOD unchanged: " << (tr.before.at("HOD") == tr.after.at("HOD") ? "yes  [ok]" : "NO  [***]") << "\n";
    std::cout << "  LEAD_A own totals unchanged (moved, not changed): "
              << (tr.before.at("LEAD_A") == tr.after.at("LEAD_A") ? "yes  [ok]" : "NO  [***]") << "\n";

    std::cout << "\n=== 4. REJECTIONS, checked in order (S6.2) ===\n";
    expectReject(s0, "NOPE",   "HOD",    ErrorCode::UNKNOWN_TRANSFER_EMPLOYEE);
    expectReject(s0, "HOD",    "MGR_A",  ErrorCode::ROOT_MOVE_FORBIDDEN);
    expectReject(s0, "HOD",    "HOD",    ErrorCode::ROOT_MOVE_FORBIDDEN);  // root beats self
    expectReject(s0, "MGR_A",  "MGR_A",  ErrorCode::SELF_MANAGER);
    expectReject(s0, "LEAD_A", "MGR_A",  ErrorCode::ALREADY_REPORTS_TO_MANAGER);
    expectReject(s0, "MGR_A",  "E_Y",    ErrorCode::MANAGEMENT_CYCLE);

    std::cout << "\n=== 5. CYCLE REJECTION HOLDS AFTER THE VALID MOVE TOO ===\n";
    expectReject(tr.state, "MGR_A", "E_Y", ErrorCode::MANAGEMENT_CYCLE);

    std::cout << "\n=== 6. ATOMICITY: rejection changed nothing (S2.3c) ===\n";
    for (const Employee& e : s0.employees)
        assert(s0.rollups.at(e.employee_id) == load(records).rollups.at(e.employee_id));
    std::cout << "  all original rollups intact after 7 rejections  [ok]\n";

    std::cout << "\n=== 7. BAD LOADS (S4.2) ===\n";
    auto bad = [&](const char* label, std::vector<Employee> recs, ErrorCode want) {
        AppState s = load(recs);
        std::cout << "  " << label << " : " << codeName(s.error.code)
                  << (s.error.code == want ? "  [expected]" : "  [*** WRONG ***]")
                  << "\n        " << s.error.message << "\n";
        assert(s.error.code == want);
        assert(s.employees.empty() && s.rollups.empty());   // §4.5 nothing partial
    };

    { auto r = records; r.push_back({"E_X","Dup","Developer",50000,std::string("HOD")});
      bad("duplicate id      ", r, ErrorCode::DUPLICATE_EMPLOYEE_ID); }

    { auto r = records; r[4].manager_id = std::string("GHOST");
      bad("unknown manager   ", r, ErrorCode::UNKNOWN_MANAGER); }

    { auto r = records; r[3].manager_id = std::string("E_X");   // LEAD_A <-> E_X loop
      bad("cycle             ", r, ErrorCode::MANAGEMENT_CYCLE); }

    { auto r = records; r[1].manager_id = std::nullopt;
      bad("two roots         ", r, ErrorCode::INVALID_ROOT_COUNT); }

    { auto r = records; r[2].monthly_salary = 0;
      bad("salary out of range", r, ErrorCode::INVALID_EMPLOYEE); }

    // precedence: record 2 self-manages, record 4 has unknown manager.
    // ONE category, source order decides -> record 2 wins -> SELF_MANAGER
    { auto r = records; r[2].manager_id = std::string("MGR_B");
                        r[4].manager_id = std::string("GHOST");
      bad("self@2 + unknown@4", r, ErrorCode::SELF_MANAGER); }

    // and the mirror: record 2 unknown, record 4 self -> record 2 wins -> UNKNOWN_MANAGER
    { auto r = records; r[2].manager_id = std::string("GHOST");
                        r[4].manager_id = std::string("E_X");
      bad("unknown@2 + self@4", r, ErrorCode::UNKNOWN_MANAGER); }

    std::cout << "\n=== 8. ONE-PERSON DEPARTMENT ===\n";
    { AppState s = load({{"SOLO","Zoya Ali","Head",99999,std::nullopt}});
      assert(s.error.ok());
      std::cout << "  SOLO team: " << s.rollups.at("SOLO").headcount
                << " / " << money(s.rollups.at("SOLO").payroll) << "  [ok]\n"; }

    std::cout << "\n=== 9. RESET + REPEATABILITY ===\n";
    { AppState reset = load(records);
      TransferResult again = applyTransfer(reset, "LEAD_A", "MGR_B");
      assert(again.ok && again.changedRollupIds == tr.changedRollupIds);
      for (const Employee& e : again.state.employees)
          assert(again.state.rollups.at(e.employee_id) == tr.state.rollups.at(e.employee_id));
      std::cout << "  reset then re-applied: identical result  [ok]\n"; }

    std::cout << "\nALL CHECKS PASSED\n";
    return 0;
}

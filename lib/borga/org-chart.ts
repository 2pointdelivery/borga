import type { Employee } from './data';

/**
 * Company organogram: reporting tree built from each employee's `manager`
 * field (matched by name, case-insensitive). Pure (no I/O) so it can be unit
 * tested; the dashboard renders it under HR → Organogram.
 *
 * Rules, all defensive because manager is free text:
 * - someone whose manager names nobody on the roster (or nobody at all) is a
 *   root — the top of the hierarchy, i.e. board & executive leadership;
 * - a manager naming yourself is ignored (you cannot report to yourself);
 * - reporting cycles are cut at the link that closes the loop;
 * - offboarded people are out of the chart (they no longer work here).
 */

export interface OrgNode {
  employee: Employee;
  reports: OrgNode[];
}

export function activeRoster(employees: Employee[]): Employee[] {
  return employees.filter((e) => e.status !== 'offboarded');
}

export function buildOrgTree(employees: Employee[]): OrgNode[] {
  const roster = activeRoster(employees);
  const byName = new Map(roster.map((e) => [e.name.trim().toLowerCase(), e]));
  const parentOf = new Map<string, string | null>();
  for (const e of roster) {
    const m = e.manager?.trim().toLowerCase();
    const mgr = m ? byName.get(m) : undefined;
    parentOf.set(e.id, mgr && mgr.id !== e.id ? mgr.id : null);
  }
  // Cut any link that would close a reporting cycle.
  for (const e of roster) {
    const seen = new Set<string>([e.id]);
    let cur = parentOf.get(e.id) ?? null;
    while (cur) {
      if (seen.has(cur)) {
        parentOf.set(e.id, null);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }
  const childrenOf = new Map<string, Employee[]>();
  for (const e of roster) {
    const p = parentOf.get(e.id);
    if (!p) continue;
    const list = childrenOf.get(p) ?? [];
    list.push(e);
    childrenOf.set(p, list);
  }
  const build = (e: Employee): OrgNode => ({
    employee: e,
    reports: (childrenOf.get(e.id) ?? []).map(build),
  });
  return roster.filter((e) => !parentOf.get(e.id)).map(build);
}

export interface DepartmentRow {
  name: string;
  /** The member who reports outside (or above) the department — null when nobody does. */
  head: Employee | null;
  members: Employee[];
}

/** Departments with their members and structural head (no keyword guessing). */
export function departmentTable(employees: Employee[]): DepartmentRow[] {
  const roster = activeRoster(employees);
  const names = [...new Set(roster.map((e) => e.department.trim() || 'General'))].sort((a, b) => a.localeCompare(b));
  return names.map((name) => {
    const members = roster.filter((e) => (e.department.trim() || 'General') === name);
    const inDept = new Set(members.map((m) => m.name.trim().toLowerCase()));
    // Head = the member whose manager sits outside this department (or who has
    // none): structurally, the person the department reports up through.
    const head = members.find((m) => {
      const mgr = m.manager?.trim().toLowerCase();
      return !mgr || !inDept.has(mgr);
    }) ?? null;
    return { name, head, members };
  });
}

/** Flat headcount per depth level, top (0) first — for the chart header. */
export function depthCounts(roots: OrgNode[]): number[] {
  const counts: number[] = [];
  const walk = (nodes: OrgNode[], depth: number) => {
    for (const n of nodes) {
      counts[depth] = (counts[depth] ?? 0) + 1;
      walk(n.reports, depth + 1);
    }
  };
  walk(roots, 0);
  return counts;
}

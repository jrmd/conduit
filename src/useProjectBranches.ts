import { useEffect, useState } from 'react';
import type { Project } from '../shared/api';

export function useProjectBranches(projects: Project[]) {
  const [branches, setBranches] = useState<Record<string, string | null>>({});
  const projectIds = JSON.stringify(projects.map(project => project.id).sort());
  useEffect(() => {
    const ids: string[] = JSON.parse(projectIds);
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const entries = await Promise.all(ids.map(async id => {
          const branch = await window.j2code.getProjectBranch(id).catch(() => null);
          return [id, branch] as const;
        }));
        if (alive) setBranches(Object.fromEntries(entries));
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [projectIds]);
  return branches;
}

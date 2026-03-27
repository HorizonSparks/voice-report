/**
 * usePersonDashboard Hook
 * Handles loading a single person's dashboard data (profile, reports, tasks).
 * Extracted from PeopleView.jsx for reusability.
 */
import { useState, useEffect, useCallback } from 'react';

export default function usePersonDashboard({ personId }) {
  const [person, setPerson] = useState(null);
  const [reports, setReports] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadPerson = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/people/${id}`);
      const p = await res.json();
      setPerson(p);

      // Load reports
      try {
        const reportsRes = await fetch(`/api/reports?person_id=${id}`);
        const reps = await reportsRes.json();
        setReports(reps);
      } catch { setReports([]); }

      // Load active tasks
      try {
        const tasksRes = await fetch(`/api/tasks/active/${id}?include_completed=true`);
        const t = await tasksRes.json();
        setTasks(Array.isArray(t) ? t : []);
      } catch { setTasks([]); }
    } catch {
      setPerson(null);
    }
    setLoading(false);
  }, []);

  // Auto-load when personId changes
  useEffect(() => {
    if (personId) loadPerson(personId);
    else {
      setPerson(null);
      setReports([]);
      setTasks([]);
    }
  }, [personId, loadPerson]);

  // Refresh reports only (for when returning from report detail)
  const refreshReports = useCallback(async () => {
    if (!personId) return;
    try {
      const res = await fetch(`/api/reports?person_id=${personId}`);
      setReports(await res.json());
    } catch {}
  }, [personId]);

  return { person, reports, tasks, loading, loadPerson, refreshReports };
}

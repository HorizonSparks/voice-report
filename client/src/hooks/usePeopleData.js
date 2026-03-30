/**
 * usePeopleData Hook
 * Handles loading people and templates data.
 * Extracted from PeopleView.jsx for reusability.
 */
import { useState, useEffect, useCallback } from 'react';

export default function usePeopleData({ user, activeTrade }) {
  const [people, setPeople] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = user && (user.is_admin || user.sparks_role);
  const myPersonId = user && user.person_id;

  const load = useCallback(() => {
    setLoading(true);
    const tradeParam = activeTrade ? `?trade=${encodeURIComponent(activeTrade)}` : '';
    Promise.all([
      fetch(`/api/people${tradeParam}`).then(r => r.json()),
      fetch('/api/templates').then(r => r.json()),
    ]).then(([p, t]) => {
      // Non-admin supervisors only see their direct reports
      if (!isAdmin && myPersonId) {
        setPeople(p.filter(person => person.supervisor_id === myPersonId));
      } else {
        setPeople(p);
      }
      setTemplates(t);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isAdmin, myPersonId, activeTrade]);

  useEffect(load, [load]);

  return { people, setPeople, templates, loading, reload: load };
}

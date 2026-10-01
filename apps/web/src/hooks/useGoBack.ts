import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * "Back" that stays inside the app: history back when this tab navigated
 * here from another in-app page, otherwise (deep link, fresh tab, email
 * link) `fallback`. React Router marks the first entry of a tab with the
 * 'default' key.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    if (key !== 'default') void navigate(-1);
    else void navigate(fallback, { replace: true });
  }, [key, navigate, fallback]);
}

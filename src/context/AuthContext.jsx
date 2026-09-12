import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase, signIn, signUp, signOut, getProfile, getWorkerProfile } from '@services/supabase';
// Safe to consume here: App.jsx nests LanguageProvider OUTSIDE AuthProvider, so the language
// context is always mounted by the time this provider renders.
import { useLanguage } from '@context/LanguageContext';

// Ported from e:\sahakar-seva-progress\src\context\AuthContext.jsx.
//
// Behaviour preserved exactly, including:
//   - the full reducer and its action set
//   - DEMO_ACCOUNTS bypassing Supabase entirely and synthesising a fake user/profile
//   - `isDemo` derived from user.id.startsWith('demo-')
//   - logout skipping Supabase signOut for demo users
//
// ONE structural change, forced by Phase 2's graceful-missing-env handling in
// services/supabase.js: `supabase` can now be null when SUPABASE_URL/ANON_KEY are unset.
// The web version could always assume a client existed (it threw at import time otherwise).
// The mount effect below therefore guards on `supabase` before touching supabase.auth.
//
// Why that matters: it keeps the DEMO path fully functional with no Supabase config at all.
// Without the guard, launching the app before real keys are in .env would crash on
// `supabase.auth.getSession()` and the demo accounts — the whole point of the demo path —
// would be unreachable.

const AuthContext = createContext(null);

const initialState = {
  user: null,
  profile: null,
  workerProfile: null,
  isAuthenticated: false,
  /**
   * BOOTSTRAP only — true while the app is restoring a saved session on launch.
   *
   * RootNavigator swaps the entire tree to <SplashScreen /> whenever this is true, so it must NEVER
   * be set for an in-page action. It used to be reused for login/register, which meant submitting
   * the login form unmounted LoginScreen (losing the chosen role AND the error message) and
   * remounted it at the role picker — so a wrong password looked like the screen "exiting" with no
   * explanation. Submitting is tracked separately below.
   */
  loading: true,
  /** An auth form is in flight. Drives button spinners only; never swaps the navigator tree. */
  submitting: false,
  error: null
};

function authReducer(state, action) {
  switch (action.type) {
    case 'AUTH_START':
      // Deliberately does NOT touch `loading` — see the note on initialState.
      return { ...state, submitting: true, error: null };
    case 'SET_SUBMITTING':
      return { ...state, submitting: action.payload };
    case 'AUTH_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        profile: action.payload.profile,
        workerProfile: action.payload.workerProfile || null,
        isAuthenticated: true,
        loading: false,
        submitting: false,
        error: null
      };
    case 'AUTH_ERROR':
      // loading stays false so the navigator keeps showing the auth tree, and submitting clears so
      // the button re-enables. The user stays exactly where they were, with `error` to display.
      return {
        ...state,
        loading: false,
        submitting: false,
        error: action.payload,
        isAuthenticated: false,
        user: null,
        profile: null
      };
    case 'LOGOUT':
      return { ...initialState, loading: false };
    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } };
    case 'UPDATE_WORKER_PROFILE':
      return { ...state, workerProfile: { ...state.workerProfile, ...action.payload } };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    default:
      return state;
  }
}

// DEMO accounts (bypass Supabase for quick demo access)
//
// ADMIN NOW HAS A DEMO BYPASS TOO. It deliberately did not before: a real Supabase login gets a
// genuine JWT, which getWorkerList() needs to read worker_profiles through RLS. That reasoning is
// still valid, but it left the admin portal unreachable on any device without a hand-created
// Supabase admin row — and since certificate verification is admin-only, a worker who signed up on
// a fresh install could never be approved and so could never be shown a single job. A demo path that
// dead-ends is worse than one with a documented limitation.
//
// THE TRADEOFF, explicitly: a demo admin has NO JWT, so getWorkerList() cannot return
// Supabase-registered workers. Everything the admin portal does with LOCAL data still works in full
// — certificate approve/decline, bans, the complaints dashboard, worker feedback, the forecast — and
// the screens that call getWorkerList() skip it for demo admins rather than showing a fetch error.
// For real multi-device administration, use a genuine Supabase admin account.
const DEMO_ACCOUNTS = {
  'demo.customer@sahakar.in': { password: 'demo123', role: 'customer', full_name: 'Rahul Sharma', phone: '+91 98765 43210', city: 'Kolkata' },
  'demo.worker@sahakar.in': { password: 'demo123', role: 'worker', full_name: 'Suresh Kumar', phone: '+91 76543 21098', city: 'Delhi' },
  'demo.admin@sahakar.in': { password: 'demo123', role: 'admin', full_name: 'Cooperative Admin', phone: '+91 90000 00000', city: 'Kolkata' },
};

/**
 * Human-readable reason shown when someone signs in through the wrong portal.
 *
 * The role selected on the login screen (customer / worker / admin) is a promise about which portal
 * the credentials belong to. If the account's real role is different we refuse the login rather than
 * silently routing them to their actual portal — otherwise picking "Customer" and entering a
 * worker's details drops you into the worker portal, which is confusing and hides the mistake.
 */
export const ROLE_MISMATCH = 'ROLE_MISMATCH';

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  // Used only for the logout confirmation copy, so the prompt follows the app's language.
  const { t } = useLanguage();

  // The role the user picked on the login screen for the CURRENT real-Supabase login attempt.
  // A ref, not state, because the onAuthStateChange listener (set up once on mount) needs to read
  // the latest value without being re-created, and because changing it must not trigger a render.
  // Null for a session restored on app launch, where no portal was chosen — that path is allowed
  // through regardless of role.
  const expectedRoleRef = useRef(null);
  // Resolves the pending real-login promise once the async SIGNED_IN handler has verified the role,
  // so handleLogin can report a mismatch that is only knowable after the profile loads.
  const loginResolveRef = useRef(null);

  // Helper: load full profile after auth
  const loadProfile = useCallback(async (userId) => {
    const { data: profile } = await getProfile(userId);
    let workerProfile = null;
    if (profile?.role === 'worker') {
      const { data } = await getWorkerProfile(userId);
      workerProfile = data;
    }
    return { profile, workerProfile };
  }, []);

  // On mount: check existing session
  useEffect(() => {
    // Guard added for mobile: supabase is null when env vars are unset (see services/supabase.js).
    // Skip straight to "not loading" so the login screen renders and demo accounts still work.
    if (!supabase) {
      dispatch({ type: 'SET_LOADING', payload: false });
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        const { profile, workerProfile } = await loadProfile(session.user.id);
        dispatch({ type: 'AUTH_SUCCESS', payload: { user: session.user, profile, workerProfile } });
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session?.user) {
        const { profile, workerProfile } = await loadProfile(session.user.id);

        // Enforce the portal the user chose on the login screen. expectedRoleRef is only set for a
        // deliberate login attempt; a session restored on launch leaves it null and is allowed
        // through. We check BEFORE dispatching AUTH_SUCCESS so the wrong portal never flashes.
        const expected = expectedRoleRef.current;
        if (expected && profile?.role && profile.role !== expected) {
          expectedRoleRef.current = null;
          await signOut(); // undo the Supabase session; do NOT dispatch AUTH_SUCCESS
          dispatch({ type: 'AUTH_ERROR', payload: ROLE_MISMATCH });
          // Hand the mismatch back to the awaiting handleLogin so it can show the right message.
          if (loginResolveRef.current) {
            loginResolveRef.current({ success: false, error: ROLE_MISMATCH, actualRole: profile.role });
            loginResolveRef.current = null;
          }
          return;
        }

        expectedRoleRef.current = null;
        dispatch({ type: 'AUTH_SUCCESS', payload: { user: session.user, profile, workerProfile } });
        if (loginResolveRef.current) {
          loginResolveRef.current({ success: true });
          loginResolveRef.current = null;
        }
      } else if (event === 'SIGNED_OUT') {
        dispatch({ type: 'LOGOUT' });
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [loadProfile]);

  /**
   * @param expectedRole  The portal chosen on the login screen ('customer' | 'worker' | 'admin').
   *                      When provided, the account's real role must match or the login is refused.
   *                      Optional so any programmatic caller without a portal context still works.
   *
   * On a role mismatch this returns { success:false, error: ROLE_MISMATCH, actualRole } WITHOUT ever
   * signing the user in, so the wrong portal is never shown even for a frame.
   */
  const login = useCallback(async (email, password, expectedRole = null) => {
    dispatch({ type: 'AUTH_START' });

    // Demo account bypass — role is known synchronously, so verify before doing anything else.
    const demo = DEMO_ACCOUNTS[email.toLowerCase()];
    if (demo && demo.password === password) {
      if (expectedRole && demo.role !== expectedRole) {
        dispatch({ type: 'AUTH_ERROR', payload: ROLE_MISMATCH });
        return { success: false, error: ROLE_MISMATCH, actualRole: demo.role };
      }
      const mockUser = { id: `demo-${demo.role}`, email };
      const mockProfile = { id: mockUser.id, role: demo.role, full_name: demo.full_name, phone: demo.phone, city: demo.city };
      const mockWorkerProfile = demo.role === 'worker' ? {
        id: mockUser.id, skills: ['Plumbing', 'Pipe Fitting'], rating: 4.8, total_jobs: 245,
        earnings: 73500, cibil_score: 780, weekly_hours_worked: 38, insurance_eligible: true,
        tier: 'tier2', leave_balance: 28, loyalty_bonus_eligible: true, available: true, verified: true
      } : null;
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: mockUser, profile: mockProfile, workerProfile: mockWorkerProfile } });
      return { success: true };
    }

    // Real Supabase login. The account's role isn't known until the profile loads, which happens in
    // the onAuthStateChange SIGNED_IN handler. So we stash the expected role and hand that handler a
    // resolver: it verifies the role there (before AUTH_SUCCESS) and reports the outcome back here.
    expectedRoleRef.current = expectedRole;

    const { error } = await signIn({ email, password });
    if (error) {
      expectedRoleRef.current = null;
      dispatch({ type: 'AUTH_ERROR', payload: error.message });
      return { success: false, error: error.message };
    }

    // signIn succeeded. If we're enforcing a role, wait for the listener's verdict (success, or a
    // mismatch that already signed the session back out). No expected role -> nothing to wait for.
    if (expectedRole) {
      return await new Promise((resolve) => {
        loginResolveRef.current = resolve;
        // Safety net: if SIGNED_IN never arrives (unexpected), don't hang the button forever.
        setTimeout(() => {
          if (loginResolveRef.current === resolve) {
            loginResolveRef.current = null;
            resolve({ success: true });
          }
        }, 8000);
      });
    }
    return { success: true };
  }, []);

  const register = useCallback(async ({ email, password, role, fullName, phone, city, state, skills, wantsTraining }) => {
    dispatch({ type: 'AUTH_START' });
    const { data, error } = await signUp({ email, password, role, fullName, phone, city, state, skills, wantsTraining });
    if (error) {
      dispatch({ type: 'AUTH_ERROR', payload: error.message });
      return { success: false, error: error.message };
    }
    // Profile auto-created via DB trigger; confirm email may be needed.
    // Clears the button spinner without touching `loading` (which would swap in the splash screen).
    dispatch({ type: 'SET_SUBMITTING', payload: false });
    return { success: true, needsEmailConfirm: !data.session };
  }, []);

  /**
   * Signs out immediately, with no prompt.
   *
   * Exposed as `logoutImmediately` for any caller that has ALREADY confirmed, or that needs to end
   * a session programmatically (a revoked account, say). UI should use `logout` below.
   */
  const logoutImmediately = useCallback(async () => {
    // Don't call Supabase signOut for demo accounts
    if (state.user?.id?.startsWith('demo-')) {
      dispatch({ type: 'LOGOUT' });
      return;
    }
    await signOut();
    dispatch({ type: 'LOGOUT' });
  }, [state.user]);

  /**
   * Confirmed logout — what every button in the app calls.
   *
   * THE CONFIRMATION LIVES HERE, NOT IN THE SCREENS. There are eight logout entry points (worker
   * dashboard header + profile + banned screen, customer profile, admin dashboard header, the
   * access-denied screen, and the two shared headers AppHeader/PortalHeader). Putting an Alert in
   * each would duplicate the strings eight times and, worse, any logout button added later would
   * silently skip the prompt. Wrapping it at the context boundary means every existing and future
   * caller is covered without touching a single screen.
   *
   * Logging out is destructive enough to be worth a tap: it drops the session, and on the customer
   * side it also discards an in-progress booking wizard.
   */
  const logout = useCallback(() => {
    Alert.alert(
      t('logout_confirm_title'),
      t('logout_confirm_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('log_out'), style: 'destructive', onPress: () => { logoutImmediately(); } },
      ],
      { cancelable: true },
    );
  }, [logoutImmediately, t]);

  const updateProfileData = useCallback((updates) => {
    dispatch({ type: 'UPDATE_PROFILE', payload: updates });
  }, []);

  const updateWorkerProfileData = useCallback((updates) => {
    dispatch({ type: 'UPDATE_WORKER_PROFILE', payload: updates });
  }, []);

  // Shorthand helpers
  const isDemo = state.user?.id?.startsWith('demo-');
  const role = state.profile?.role;

  return (
    <AuthContext.Provider value={{
      ...state,
      role,
      isDemo,
      login,
      register,
      logout,
      logoutImmediately,
      updateProfileData,
      updateWorkerProfileData,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

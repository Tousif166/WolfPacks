import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home, Briefcase, User, CalendarOff, BookOpen } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import { useAuth } from '@context/AuthContext';
import { useWorkerRegistration, isBanned, isCertificatePending } from '@data/workerRegistration';
import WorkerBannedScreen from '@screens/worker/WorkerBannedScreen';
import WorkerDashboardScreen from '@screens/worker/WorkerDashboardScreen';
import JobFeedScreen from '@screens/worker/JobFeedScreen';
import WorkerProfileScreen from '@screens/worker/WorkerProfileScreen';
import LeaveRequestsScreen from '@screens/worker/LeaveRequestsScreen';
import WorkerTrainingPortalScreen from '@screens/worker/WorkerTrainingPortalScreen';
import { colors, spacing, radii, fontWeights, fontFamilies } from '@theme';

/**
 * WorkerTabs — bottom-tab navigator for the worker portal.
 * Ports WorkerLayout.jsx's navItems (Dashboard/Jobs/Profile/Leave/Training). Worker accent is
 * amber (web used an amber gradient avatar/brand). Screens own their in-content PortalHeader,
 * so the tab-navigator chrome header is hidden (headerShown:false).
 *
 * VISUAL (presentation-only): the active tab's icon sits inside a soft-orange rounded pill for a
 * clearer, more premium active state. Routes, labels, and screen components are unchanged.
 */

const Tab = createBottomTabNavigator();

/** Renders a tab icon inside a soft-orange pill when the tab is focused (presentation only). */
function TabIcon({ icon: Icon, color, focused }) {
  return (
    <View style={[styles.iconPill, focused && styles.iconPillActive]}>
      <Icon color={color} size={22} strokeWidth={focused ? 2.6 : 2} />
    </View>
  );
}

export default function WorkerTabs() {
  const { t } = useLanguage();
  const { user } = useAuth();

  /**
   * ACCESS GATING on certificate verification (see src/data/workerRegistration.js):
   *
   *  - BANNED (certificate found to be fraudulent): the tab navigator is not rendered at all, so
   *    there is no route to the dashboard, jobs, profile, leave or training. Only a reason and a
   *    logout button. Hiding the tabs rather than disabling their contents means there is no
   *    surface left to slip through.
   *
   *  - CERTIFICATE PENDING review: the worker stays logged in but only the Dashboard tab exists,
   *    where an "under review" notice explains the wait. Logout lives in the dashboard header, so
   *    they are not trapped. The remaining tabs are omitted rather than shown-and-blocked, because
   *    a visible tab that refuses to do anything reads as a bug.
   */
  const registration = useWorkerRegistration(user?.email);
  const banned = isBanned(registration);
  const awaitingVerification = isCertificatePending(registration);

  if (banned) return <WorkerBannedScreen />;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent600,
        tabBarInactiveTintColor: colors.gray400,
        // Premium bar (matches the customer portal): white surface, hairline top border, soft
        // upward lift, taller touch targets. Height/padding stack on top of the bottom safe-area
        // inset (RN bottom-tabs adds it automatically), so it stays correct across devices.
        tabBarStyle: {
          backgroundColor: colors.surfaceWhite,
          borderTopColor: colors.gray100,
          borderTopWidth: 1,
          height: 64,
          paddingTop: spacing.space2,
          paddingBottom: spacing.space2,
          elevation: 12,
          shadowColor: colors.gray900,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarItemStyle: { paddingTop: 2 },
        // Allow the label a bit of room + shrink so "Leave Requests" / "Training" never truncate.
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: fontFamilies.interSemiBold,
          fontWeight: fontWeights.fwSemibold,
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="WorkerDashboard"
        component={WorkerDashboardScreen}
        options={{ title: t('dashboard'), tabBarIcon: (p) => <TabIcon icon={Home} {...p} /> }}
      />
      {/* Everything past the dashboard is withheld until the uploaded certificate is reviewed. */}
      {!awaitingVerification && (
        <>
          <Tab.Screen
            name="WorkerJobs"
            component={JobFeedScreen}
            options={{ title: t('jobs'), tabBarIcon: (p) => <TabIcon icon={Briefcase} {...p} /> }}
          />
          <Tab.Screen
            name="WorkerProfile"
            component={WorkerProfileScreen}
            options={{ title: t('profile'), tabBarIcon: (p) => <TabIcon icon={User} {...p} /> }}
          />
          <Tab.Screen
            name="WorkerLeave"
            component={LeaveRequestsScreen}
            options={{ title: t('leave'), tabBarIcon: (p) => <TabIcon icon={CalendarOff} {...p} /> }}
          />
          <Tab.Screen
            name="WorkerTraining"
            component={WorkerTrainingPortalScreen}
            options={{ title: t('training'), tabBarIcon: (p) => <TabIcon icon={BookOpen} {...p} /> }}
          />
        </>
      )}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    minWidth: 44,
    height: 30,
    borderRadius: radii.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.space3,
  },
  iconPillActive: {
    backgroundColor: colors.accent50,
  },
});

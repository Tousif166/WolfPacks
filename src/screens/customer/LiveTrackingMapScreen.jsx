import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import {
  Phone, MessageCircle, Share2, ShieldCheck, Navigation, CheckCircle2, ArrowLeft,
  Route as RouteIcon, Bike, Home as HomeIcon, Pause, Play, RotateCcw, MapPin, Star,
} from 'lucide-react-native';
import { mockBookings, DEFAULT_ADDRESS } from '@data/mockBookings';
import { mockWorkers } from '@data/mockWorkers';
import { useLanguage } from '@context/LanguageContext';
import Badge from '@components/ui/Badge';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * LiveTrackingMapScreen — ported from web pages/customer/LiveTrackingMap.jsx.
 *
 * WHAT'S REAL vs MOCK (unchanged product decision): the worker MOVEMENT is a scripted showcase
 * (hardcoded CUSTOMER_ROUTE + timed sim), but the worker↔home DISTANCE and ETA are computed for
 * real via haversine every tick. Preserved verbatim: booking/worker resolution, the route, the
 * simulation loop, camera modes, OTP, call/message/share handlers, replay/pause.
 *
 * MAP RENDERING:
 *   - The frontend map component (react-native-maps MapView + Google provider) is the real,
 *     interactive map — NOT a placeholder. Markers/polylines/camera all work.
 *   - The Android Google Maps SDK authenticates with AndroidManifest.xml's
 *     com.google.android.geo.API_KEY, which resolves (via react-native-config's dotenv.gradle)
 *     from GOOGLE_MAPS_API_KEY in .env. A valid key IS now configured, so real tiles render.
 *     (Historical note: while that value was the "YOUR_GOOGLE_MAPS_API_KEY" placeholder the SDK
 *     failed auth and drew a blank/beige surface — if tiles ever disappear again, check the key,
 *     that "Maps SDK for Android" is enabled, and that billing is active. See MIGRATION_NOTES.md
 *     §6.2.)
 *
 *   NOTE on a prior "fix": dropping the Google provider does NOT switch Android to a keyless
 *   renderer — react-native-maps uses Google Maps on Android regardless — so it never helped the
 *   tiles and only made the code misleading. We restore provider={PROVIDER_GOOGLE} (the correct,
 *   original config) and remove the fake beige backdrop that masqueraded as a map. No
 *   location/route/tracking data or logic changed.
 *
 * UI REDESIGN: premium floating header, redesigned live-distance pill, compact icon map controls,
 * and a polished floating bottom sheet. All values remain dynamic from the existing data.
 */

/**
 * Demo tracking route: Ruby General Hospital → Heritage Institute of Technology, Kolkata.
 *
 * Real-world endpoints, so the polyline lands on actual roads once a valid Maps API key is in
 * place (see the MAP-RENDER DIAGNOSIS note above):
 *   - Ruby General Hospital, Kasba Golpark, E. M. Bypass — 22.5135, 88.4030
 *   - Heritage Institute of Technology, 994 Madurdaha, Chowbaga Road, Anandapur — 22.5165, 88.4182
 * The intermediate waypoints trace E. M. Bypass east, then Anandapur Road, then Chowbaga Road
 * north-east to the campus — the same shape as the reference Google Maps route (~1.6 km direct).
 *
 * Each step carries a translation KEY plus its proper nouns as params, so the sentence localises
 * while road/landmark names stay as-is. `statusMsg` (raw English) was replaced by `statusKey` for
 * this reason.
 */
const CUSTOMER_ROUTE = [
  { lat: 22.5135, lng: 88.4030, statusKey: 'track_msg_started', params: { place: 'Ruby General Hospital' } },
  { lat: 22.5131, lng: 88.4056, statusKey: 'track_msg_driving', params: { road: 'E. M. Bypass' } },
  { lat: 22.5124, lng: 88.4084, statusKey: 'track_msg_junction', params: { place: 'Kalikapur' } },
  { lat: 22.5119, lng: 88.4110, statusKey: 'track_msg_crossing', params: { place: 'Anandapur Road' } },
  { lat: 22.5120, lng: 88.4137, statusKey: 'track_msg_crossing', params: { place: 'Urbana, Anandapur' } },
  { lat: 22.5131, lng: 88.4159, statusKey: 'track_msg_turning', params: { road: 'Chowbaga Road' } },
  { lat: 22.5145, lng: 88.4172, statusKey: 'track_msg_near', params: { place: 'Madurdaha' } },
  { lat: 22.5155, lng: 88.4178, statusKey: 'track_msg_gate', params: { place: 'Heritage Institute of Technology' } },
  { lat: 22.5161, lng: 88.4180, statusKey: 'track_msg_entering', params: { place: 'Heritage Institute of Technology' } },
  { lat: 22.51653, lng: 88.41821, statusKey: 'track_msg_arrived', params: { place: 'Heritage Institute of Technology' } },
];

// Subtle premium map styling (honored by the default Google renderer on Android).
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f4f3f8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dbe7dd' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#f0eefb' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e6e2fa' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c7d2fe' }] },
];

function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function interpolateRoute(points, stepsPerSegment = 35) {
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      result.push({
        lat: p1.lat + (p2.lat - p1.lat) * t,
        lng: p1.lng + (p2.lng - p1.lng) * t,
        statusKey: p1.statusKey,
        params: p1.params,
        totalProgress: ((i * stepsPerSegment + s) / ((points.length - 1) * stepsPerSegment)) * 100,
      });
    }
  }
  const last = points[points.length - 1];
  result.push({ lat: last.lat, lng: last.lng, statusKey: last.statusKey, params: last.params, totalProgress: 100 });
  return result;
}

// ~14 km/h — realistic two-wheeler speed through Anandapur/E. M. Bypass city traffic. Combined
// with the ~1.6 km Ruby → Heritage leg this opens the tracker at "7 min", matching what Google
// Maps quotes for the same drive.
const SPEED_M_PER_MIN = 230;

// Format meters -> dynamic "x.x km" / "xxx m" (presentation only; value stays dynamic).
function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km away`;
  return `${meters} m away`;
}

export default function LiveTrackingMapScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const bookingId = route?.params?.bookingId;

  const mapRef = useRef(null);
  const [simIndex, setSimIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [cameraMode, setCameraMode] = useState('overview');

  const booking =
    mockBookings.find((b) => b.id === bookingId) ||
    mockBookings.find((b) => b.status === 'en-route') ||
    mockBookings[0];

  // The BOOKING is the source of truth for who accepted the job — it carries the accepting
  // worker's name/phone/rating (set by acceptBooking). The mockWorkers record is only consulted
  // for extra demo detail, and must NOT be used as a blanket fallback: a real (non-demo) worker
  // has no mockWorkers entry, and falling back to mockWorkers[0] would display the wrong person.
  const workerRecord = mockWorkers.find((w) => w.id === booking?.workerId);
  const worker = {
    ...(workerRecord || {}),
    name: booking?.workerName || workerRecord?.name || 'Worker',
    phone: booking?.workerPhone || workerRecord?.phone || '9876543210',
    rating: booking?.workerRating ?? workerRecord?.rating ?? null,
    cooperative: workerRecord?.cooperative || 'Sahakar Cooperative',
  };

  const home = CUSTOMER_ROUTE[CUSTOMER_ROUTE.length - 1];
  const interpolatedRoute = useMemo(() => interpolateRoute(CUSTOMER_ROUTE, 35), []);
  const currentPoint = interpolatedRoute[simIndex] || interpolatedRoute[0];
  const isArrived = simIndex >= interpolatedRoute.length - 1;
  const progressPercent = Math.round(currentPoint.totalProgress);

  const remainingDistanceMeters = Math.round(
    haversineMeters(currentPoint.lat, currentPoint.lng, home.lat, home.lng)
  );
  const etaMinutes = isArrived ? 0 : Math.max(1, Math.ceil(remainingDistanceMeters / SPEED_M_PER_MIN));

  const fullRouteCoords = useMemo(
    () => CUSTOMER_ROUTE.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    []
  );
  const traveledCoords = useMemo(
    () => interpolatedRoute.slice(0, simIndex + 1).map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [interpolatedRoute, simIndex]
  );

  useEffect(() => {
    if (!isPlaying || isArrived) return undefined;
    const interval = setInterval(() => {
      setSimIndex((prev) => {
        if (prev < interpolatedRoute.length - 1) return prev + 1;
        setIsPlaying(false);
        return prev;
      });
    }, 130);
    return () => clearInterval(interval);
  }, [isPlaying, isArrived, interpolatedRoute.length]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (cameraMode === 'worker') {
      mapRef.current.animateCamera({ center: { latitude: currentPoint.lat, longitude: currentPoint.lng } }, { duration: 250 });
    } else if (cameraMode === 'home') {
      mapRef.current.animateCamera({ center: { latitude: home.lat, longitude: home.lng } }, { duration: 250 });
    }
  }, [simIndex, cameraMode, currentPoint.lat, currentPoint.lng, home.lat, home.lng]);

  const fitOverview = () => {
    setCameraMode('overview');
    mapRef.current?.fitToCoordinates(fullRouteCoords, {
      edgePadding: { top: 140, right: 70, bottom: 360, left: 70 },
      animated: true,
    });
  };

  const focusWorker = () => {
    setCameraMode('worker');
    mapRef.current?.animateCamera({ center: { latitude: currentPoint.lat, longitude: currentPoint.lng }, zoom: 16 }, { duration: 400 });
  };

  const focusHome = () => {
    setCameraMode('home');
    mapRef.current?.animateCamera({ center: { latitude: home.lat, longitude: home.lng }, zoom: 16 }, { duration: 400 });
  };

  const replay = () => {
    setSimIndex(0);
    setIsPlaying(true);
    fitOverview();
  };

  const callWorker = () => {
    const tel = (worker.phone || '9876543210').replace(/\s/g, '');
    Linking.openURL(`tel:${tel}`).catch(() => Alert.alert(t('unable_to_call')));
  };

  // First frame only — onMapReady immediately calls fitOverview() to frame the whole route.
  // Centred between Ruby General Hospital and the Heritage campus, Anandapur, Kolkata.
  const initialRegion = {
    latitude: 22.5150,
    longitude: 88.4106,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  return (
    <View style={styles.root}>
      {/* The real, interactive Google map fills the whole screen behind the overlays. */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        customMapStyle={MAP_STYLE}
        onMapReady={fitOverview}
        onPanDrag={() => setCameraMode('manual')}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        loadingEnabled
        loadingBackgroundColor="#eceaf6"
        loadingIndicatorColor={colors.primary600}
      >
        <Polyline coordinates={fullRouteCoords} strokeColor={colors.primary200} strokeWidth={7} lineCap="round" lineJoin="round" />
        <Polyline coordinates={traveledCoords} strokeColor={colors.primary600} strokeWidth={7} lineCap="round" />

        <Marker coordinate={{ latitude: home.lat, longitude: home.lng }} title="Your Home" description={booking?.address} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.homeMarker}>
            <HomeIcon size={18} color={colors.white} strokeWidth={2.4} />
          </View>
          <View style={styles.markerSpike} />
        </Marker>

        <Marker coordinate={{ latitude: currentPoint.lat, longitude: currentPoint.lng }} title={worker.name} anchor={{ x: 0.5, y: 0.5 }} flat>
          {!isArrived && <View style={styles.workerPulse} />}
          <View style={styles.workerMarker}>
            <Bike size={18} color={colors.white} strokeWidth={2.4} />
          </View>
        </Marker>
      </MapView>

      {/* Floating header */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.space3 }]}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={8} accessibilityLabel="Go back">
          <ArrowLeft size={20} color={colors.gray800} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.topTitleWrap}>
          <Text style={styles.topTitle} numberOfLines={1}>{t('track_professional')}</Text>
          <Text style={styles.topSub} numberOfLines={1}>{booking?.serviceName} • #{booking?.id}</Text>
        </View>
        <Badge variant={isArrived ? 'success' : 'primary'}>{isArrived ? t('arrived_check') : t('on_the_way')}</Badge>
      </View>

      {/* Live distance pill */}
      <View style={[styles.livePill, { top: insets.top + 72 }]}>
        <View style={styles.livePulseDot} />
        <Text style={styles.livePillText}>{isArrived ? t('reached') : formatDistance(remainingDistanceMeters)}</Text>
      </View>

      {/* Compact icon map controls — anchored from the top (relative to the pill) so they always
          stay in the visible viewport on the right and are never covered by the bottom sheet. */}
      <View style={[styles.cameraControls, { top: insets.top + 130 }]}>
        <CamBtn icon={RouteIcon} active={cameraMode === 'overview'} onPress={fitOverview} label={t('route')} />
        <CamBtn icon={Bike} active={cameraMode === 'worker'} onPress={focusWorker} label={t('worker')} />
        <CamBtn icon={HomeIcon} active={cameraMode === 'home'} onPress={focusHome} label={t('home')} />
      </View>

      {/* Bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.space3 }]}>
        <View style={styles.grabber} />

        {/* Status line */}
        <View style={styles.statusRow}>
          <View style={[styles.statusIcon, isArrived ? styles.statusIconDone : styles.statusIconLive]}>
            {isArrived ? <CheckCircle2 size={18} color={colors.success600} /> : <Navigation size={16} color={colors.primary600} strokeWidth={2.4} />}
          </View>
          <Text style={styles.statusText} numberOfLines={2}>{t(currentPoint.statusKey, currentPoint.params)}</Text>
        </View>

        {/* ETA + address + play/pause */}
        <View style={styles.etaRow}>
          <View style={styles.etaLeft}>
            <Text style={styles.etaTime}>{isArrived ? t('arrived_excl') : t('min_suffix', { n: etaMinutes })}</Text>
            <View style={styles.etaAddrRow}>
              <MapPin size={12} color={colors.gray400} strokeWidth={2} />
              <Text style={styles.etaSub} numberOfLines={1}>{booking?.address || DEFAULT_ADDRESS}</Text>
            </View>
          </View>
          {isArrived ? (
            <Pressable style={styles.playBtn} onPress={replay}>
              <RotateCcw size={14} color={colors.primary700} strokeWidth={2.2} />
              <Text style={styles.playBtnText}>{t('replay')}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.playBtn} onPress={() => setIsPlaying((p) => !p)}>
              {isPlaying ? <Pause size={14} color={colors.primary700} strokeWidth={2.2} /> : <Play size={14} color={colors.primary700} strokeWidth={2.2} />}
              <Text style={styles.playBtnText}>{isPlaying ? t('pause') : t('play')}</Text>
            </Pressable>
          )}
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>

        {/* OTP */}
        <View style={styles.otpCard}>
          <View style={styles.otpIcon}>
            <ShieldCheck size={18} color={colors.success700} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.otpLabel}>{t('start_service_otp')}</Text>
            <Text style={styles.otpHint}>{t('otp_hint')}</Text>
          </View>
          <Text style={styles.otpCode}>4892</Text>
        </View>

        {/* Worker profile + actions */}
        <View style={styles.workerCard}>
          <View style={styles.workerAvatar}><Text style={styles.workerAvatarText}>{worker.name[0]}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.workerName} numberOfLines={1}>{worker.name}</Text>
            <View style={styles.workerMetaRow}>
              <Star size={12} color={colors.accent400} fill={colors.accent400} />
              <Text style={styles.workerMeta} numberOfLines={1}>
                {worker.rating?.toFixed(1)} • {worker.cooperative || 'Sahakar Cooperative'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn} onPress={callWorker}>
            <Phone size={16} color={colors.primary600} strokeWidth={2.2} /><Text style={styles.actionText}>{t('call')}</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => Alert.alert(t('message'), t('connecting_with', { name: worker.name.split(' ')[0] }))}>
            <MessageCircle size={16} color={colors.primary600} strokeWidth={2.2} /><Text style={styles.actionText}>{t('message')}</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => Alert.alert(t('share_eta'), t('tracking_link_copied'))}>
            <Share2 size={16} color={colors.primary600} strokeWidth={2.2} /><Text style={styles.actionText}>{t('share')}</Text>
          </Pressable>
        </View>

        <View style={styles.safetyTip}>
          <ShieldCheck size={13} color={colors.success600} strokeWidth={2.2} />
          <Text style={styles.safetyText}>{t('safety_tip')}</Text>
        </View>
      </View>
    </View>
  );
}

function CamBtn({ icon: Icon, active, onPress, label }) {
  return (
    <Pressable style={[styles.camBtn, active && styles.camBtnActive]} onPress={onPress} accessibilityLabel={label}>
      <Icon size={18} color={active ? colors.white : colors.gray700} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // While tiles load the map shows this neutral color; it is the map's own loading background,
  // not a fake surface layered over the map.
  root: { flex: 1, backgroundColor: '#eceaf6' },

  // ---- Header ----
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    paddingHorizontal: spacing.space3, paddingBottom: spacing.space3,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderBottomLeftRadius: radii.radiusXl, borderBottomRightRadius: radii.radiusXl,
    ...shadows.shadowMd,
  },
  backBtn: { width: 40, height: 40, borderRadius: radii.radiusFull, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  topTitleWrap: { flex: 1 },
  topTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  topSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },

  // ---- Live pill ----
  livePill: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(17,24,39,0.92)', ...shadows.shadowLg,
  },
  livePulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success500 },
  livePillText: { color: colors.white, fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, letterSpacing: 0.3 },

  // ---- Markers ----
  homeMarker: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.danger500,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white, ...shadows.shadowMd,
  },
  markerSpike: { alignSelf: 'center', width: 3, height: 8, backgroundColor: colors.white, marginTop: -2, borderRadius: 2 },
  workerMarker: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary600,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white, ...shadows.shadowLg,
  },
  workerPulse: {
    position: 'absolute', top: -8, left: -8, right: -8, bottom: -8,
    borderRadius: 30, backgroundColor: colors.primary400, opacity: 0.35,
  },

  // ---- Camera controls ----
  // A single refined pill-group on the right, dividers between buttons, consistent with the UI.
  cameraControls: {
    position: 'absolute', right: spacing.space3,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: radii.radiusFull,
    paddingVertical: spacing.space1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gray200,
    ...shadows.shadowLg,
  },
  camBtn: {
    width: 46, height: 46, borderRadius: radii.radiusFull,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 4, marginVertical: 2,
  },
  camBtnActive: { backgroundColor: colors.primary600, ...shadows.shadowSm },

  // ---- Bottom sheet ----
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.radius2xl, borderTopRightRadius: radii.radius2xl,
    paddingHorizontal: spacing.space4, paddingTop: spacing.space2, gap: spacing.space3,
    ...shadows.shadowXl,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray200, marginBottom: spacing.space1 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  statusIcon: { width: 34, height: 34, borderRadius: radii.radiusFull, alignItems: 'center', justifyContent: 'center' },
  statusIconLive: { backgroundColor: colors.primary50 },
  statusIconDone: { backgroundColor: colors.success50 },
  statusText: { flex: 1, fontSize: fontSizes.fsSm, color: colors.gray700, fontFamily: fontFamilies.interMedium },

  etaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.space3 },
  etaLeft: { flex: 1 },
  etaTime: { fontSize: fontSizes.fs2xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  etaAddrRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  etaSub: { flex: 1, fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: spacing.space2, paddingHorizontal: spacing.space4, borderRadius: radii.radiusFull,
    backgroundColor: colors.primary50, borderWidth: 1, borderColor: colors.primary200,
  },
  playBtnText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.primary700 },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.gray200, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary600 },

  otpCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    padding: spacing.space3, backgroundColor: colors.success50, borderRadius: radii.radiusLg,
    borderWidth: 1, borderColor: colors.success100,
  },
  otpIcon: { width: 36, height: 36, borderRadius: radii.radiusFull, backgroundColor: colors.success100, alignItems: 'center', justifyContent: 'center' },
  otpLabel: { fontSize: fontSizes.fsXs, color: colors.success700, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  otpHint: { fontSize: 11, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  otpCode: { fontSize: fontSizes.fs2xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.success700, letterSpacing: 3 },

  workerCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  workerAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent500, alignItems: 'center', justifyContent: 'center' },
  workerAvatarText: { color: colors.white, fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold },
  workerName: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  workerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  workerMeta: { flex: 1, fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },

  actionRow: { flexDirection: 'row', gap: spacing.space2 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.space3, borderRadius: radii.radiusLg, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.surfaceWhite,
  },
  actionText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.primary700 },

  safetyTip: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  safetyText: { flex: 1, fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, lineHeight: 16 },
});

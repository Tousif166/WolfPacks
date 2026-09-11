// Mock routes for the live tracking map
// Each route is an array of [lat, lng] waypoints that a worker marker follows
//
// NOTE: nothing currently imports this file — LiveTrackingMapScreen defines its own
// CUSTOMER_ROUTE (with per-step status keys, which these plain waypoint pairs cannot carry).
// route1 is kept in sync with that screen's Kolkata route so the two never disagree; routes 2–3
// remain Delhi examples.

export const mockRoutes = [
  {
    id: 'route1',
    name: 'Ruby General Hospital → Heritage Institute of Technology, Kolkata',
    totalDuration: 30, // seconds for demo (represents ~7 min in reality)
    customerLocation: [22.51653, 88.41821],
    workerStart: [22.5135, 88.4030],
    waypoints: [
      [22.5135, 88.4030],
      [22.5131, 88.4056],
      [22.5124, 88.4084],
      [22.5119, 88.4110],
      [22.5120, 88.4137],
      [22.5131, 88.4159],
      [22.5145, 88.4172],
      [22.5157, 88.4179],
      [22.51653, 88.41821]
    ]
  },
  {
    id: 'route2',
    name: 'Rajouri Garden → Dwarka, Delhi',
    totalDuration: 36,
    customerLocation: [28.5921, 77.0460],
    workerStart: [28.6492, 77.1214],
    waypoints: [
      [28.6492, 77.1214],
      [28.6450, 77.1150],
      [28.6410, 77.1080],
      [28.6370, 77.1010],
      [28.6330, 77.0940],
      [28.6290, 77.0870],
      [28.6250, 77.0800],
      [28.6210, 77.0740],
      [28.6170, 77.0680],
      [28.6130, 77.0620],
      [28.6090, 77.0570],
      [28.6050, 77.0530],
      [28.6010, 77.0500],
      [28.5970, 77.0475],
      [28.5940, 77.0465],
      [28.5921, 77.0460]
    ]
  },
  {
    id: 'route3',
    name: 'Connaught Place → South Delhi',
    totalDuration: 32,
    customerLocation: [28.5494, 77.2001],
    workerStart: [28.6315, 77.2167],
    waypoints: [
      [28.6315, 77.2167],
      [28.6260, 77.2155],
      [28.6200, 77.2140],
      [28.6140, 77.2125],
      [28.6080, 77.2110],
      [28.6020, 77.2095],
      [28.5960, 77.2080],
      [28.5900, 77.2065],
      [28.5840, 77.2050],
      [28.5780, 77.2035],
      [28.5720, 77.2025],
      [28.5660, 77.2018],
      [28.5600, 77.2010],
      [28.5540, 77.2005],
      [28.5494, 77.2001]
    ]
  }
];

export const getRouteForBooking = (bookingId) => {
  // For the demo, cycle through routes based on booking ID
  const index = parseInt(bookingId.replace('BK', '')) % mockRoutes.length;
  return mockRoutes[index];
};

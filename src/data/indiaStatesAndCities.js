/**
 * India's 28 states + 8 union territories, with major cities.
 *
 * WHY ONLY MAJOR CITIES: a full enumeration of every city/town/village would be tens of thousands
 * of entries, unusable in a dropdown. This list covers state capitals, metros, and tier-2 cities —
 * enough for a functional demo without overwhelming the picker. A production deployment would either
 * fetch cities from an API keyed by state, or let the user free-text their city after picking state.
 *
 * Cities are deliberately NOT exhaustive. If a worker's city isn't listed, they pick the nearest
 * major city or the state capital — enough to route jobs and calculate travel.
 */

export const STATES_AND_UTS = [
  // States
  {
    name: 'Andhra Pradesh',
    cities: ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Kakinada'],
  },
  {
    name: 'Arunachal Pradesh',
    cities: ['Itanagar', 'Naharlagun', 'Pasighat'],
  },
  {
    name: 'Assam',
    cities: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia'],
  },
  {
    name: 'Bihar',
    cities: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Purnia', 'Darbhanga', 'Bihar Sharif'],
  },
  {
    name: 'Chhattisgarh',
    cities: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon'],
  },
  {
    name: 'Goa',
    cities: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
  },
  {
    name: 'Gujarat',
    cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Gandhinagar'],
  },
  {
    name: 'Haryana',
    cities: ['Faridabad', 'Gurgaon', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal'],
  },
  {
    name: 'Himachal Pradesh',
    cities: ['Shimla', 'Dharamshala', 'Solan', 'Mandi', 'Kullu', 'Hamirpur'],
  },
  {
    name: 'Jharkhand',
    cities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh'],
  },
  {
    name: 'Karnataka',
    cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi', 'Davangere', 'Ballari', 'Tumkuru'],
  },
  {
    name: 'Kerala',
    cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur', 'Palakkad'],
  },
  {
    name: 'Madhya Pradesh',
    cities: ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna'],
  },
  {
    name: 'Maharashtra',
    cities: ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati'],
  },
  {
    name: 'Manipur',
    cities: ['Imphal', 'Thoubal', 'Bishnupur'],
  },
  {
    name: 'Meghalaya',
    cities: ['Shillong', 'Tura', 'Jowai'],
  },
  {
    name: 'Mizoram',
    cities: ['Aizawl', 'Lunglei', 'Champhai'],
  },
  {
    name: 'Nagaland',
    cities: ['Kohima', 'Dimapur', 'Mokokchung'],
  },
  {
    name: 'Odisha',
    cities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri'],
  },
  {
    name: 'Punjab',
    cities: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur'],
  },
  {
    name: 'Rajasthan',
    cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar', 'Sikar'],
  },
  {
    name: 'Sikkim',
    cities: ['Gangtok', 'Namchi', 'Gyalshing'],
  },
  {
    name: 'Tamil Nadu',
    cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore'],
  },
  {
    name: 'Telangana',
    cities: ['Hyderabad', 'Warangal', 'Nizamabad', 'Khammam', 'Karimnagar', 'Mahbubnagar'],
  },
  {
    name: 'Tripura',
    cities: ['Agartala', 'Udaipur', 'Dharmanagar'],
  },
  {
    name: 'Uttar Pradesh',
    cities: [
      'Lucknow',
      'Kanpur',
      'Ghaziabad',
      'Agra',
      'Varanasi',
      'Meerut',
      'Allahabad',
      'Bareilly',
      'Aligarh',
      'Moradabad',
      'Saharanpur',
      'Gorakhpur',
    ],
  },
  {
    name: 'Uttarakhand',
    cities: ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur'],
  },
  {
    name: 'West Bengal',
    cities: ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Malda'],
  },

  // Union Territories
  {
    name: 'Andaman and Nicobar Islands',
    cities: ['Port Blair'],
  },
  {
    name: 'Chandigarh',
    cities: ['Chandigarh'],
  },
  {
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    cities: ['Daman', 'Silvassa', 'Diu'],
  },
  {
    name: 'Delhi',
    cities: ['New Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi', 'Central Delhi'],
  },
  {
    name: 'Jammu and Kashmir',
    cities: ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla'],
  },
  {
    name: 'Ladakh',
    cities: ['Leh', 'Kargil'],
  },
  {
    name: 'Lakshadweep',
    cities: ['Kavaratti'],
  },
  {
    name: 'Puducherry',
    cities: ['Puducherry', 'Karaikal', 'Mahe', 'Yanam'],
  },
];

/** Returns cities for a given state, or empty array if unknown. */
export function getCitiesForState(stateName) {
  const entry = STATES_AND_UTS.find((s) => s.name === stateName);
  return entry ? entry.cities : [];
}

/** All state/UT names as a flat array, for the state dropdown. */
export const STATE_NAMES = STATES_AND_UTS.map((s) => s.name);

/* field_gps_map — 設定(公開前提の値。Firebase の apiKey は秘密ではなく、守りは firestore.rules)。
 * Firebase プロジェクトは field_visit_map と共有している。
 * v2.0.0 から Google マップは使わない(地図は自前の衛星写真。lib/imagery.js)ので Maps API キーは外した。 */
window.FIELD_GPS_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyBVIqK4Xq42N8b107daWjWtNyPvyZja7Tw',
    authDomain: 'kazdr-field-visit-map.firebaseapp.com',
    projectId: 'kazdr-field-visit-map',
    storageBucket: 'kazdr-field-visit-map.firebasestorage.app',
    messagingSenderId: '829426716512',
    appId: '1:829426716512:web:c8f44371bef9bb54e85805'
  },
  defaultCenter: { lat: -14.81, lng: 38.32 },
  defaultZoom: 13
};

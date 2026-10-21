/* field_gps_map — 設定(公開前提の値。Firebase の apiKey は秘密ではなく、守りは firestore.rules)。
 * Firebase プロジェクトと Maps API キーは field_visit_map と共有している
 * (Maps キーは https://mameyompo-maker.github.io/* と localhost に制限済み)。 */
window.FIELD_GPS_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyBVIqK4Xq42N8b107daWjWtNyPvyZja7Tw',
    authDomain: 'kazdr-field-visit-map.firebaseapp.com',
    projectId: 'kazdr-field-visit-map',
    storageBucket: 'kazdr-field-visit-map.firebasestorage.app',
    messagingSenderId: '829426716512',
    appId: '1:829426716512:web:c8f44371bef9bb54e85805'
  },
  mapsApiKey: 'AIzaSyDFBo75cjAY_9NfX5rOTmhPbx-0W9SqhwY',
  mapId: '7f2b9e1cba88fab81f5ade56',
  defaultCenter: { lat: -14.81, lng: 38.32 },
  defaultZoom: 13
};

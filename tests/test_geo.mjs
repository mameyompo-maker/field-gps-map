// node tests/test_geo.mjs — 測地計算の照合テスト
import * as g from '../docs/lib/geo.js';
let ok = 0, ng = 0;
const check = (name, cond, info = '') => { if (cond) ok++; else { ng++; console.log('NG', name, info); } };

// 1) Malema 2 Block 3(2026-10-02 のセッションで平面近似により 3.90 ha と算出)
const b3 = [[-14.8102180, 40.3230450], [-14.8095470, 40.3252860], [-14.8108290, 40.3257340], [-14.8115230, 40.3233230]]
  .map(([lat, lng]) => ({ lat, lng }));
const a3 = g.polygonArea(b3) / 10000;
check('block3 area ≈ 3.90 ha', Math.abs(a3 - 3.90) < 0.02, a3.toFixed(3));
// 向きを逆にしても同じ
check('orientation independent', Math.abs(g.polygonArea([...b3].reverse()) / 10000 - a3) < 1e-9);
// 8の字の並びは交差ありと判定
check('bowtie detected', g.selfIntersects([b3[0], b3[2], b3[1], b3[3]]) === true);
check('normal not intersect', g.selfIntersects(b3) === false);

// 2) 赤道上の 0.001°×0.001° の正方形 ≈ 111.32m × 111.32m ≈ 12,392 m²
const sq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }];
const asq = g.polygonArea(sq);
check('equator square', Math.abs(asq - 12392) < 15, asq.toFixed(1));
check('perimeter', Math.abs(g.pathLength(sq, true) - 4 * 111.32) < 1, g.pathLength(sq, true).toFixed(2));

// 3) 100m × 100m の正方形を平面座標から作って 1.000 ha に戻るか(モザンビーク北部の緯度)
const pr = g.makeLocalProjection({ lat: -14.8, lng: 38.3 });
const sq2 = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }].map(pr.toLatLng);
check('1 ha square', Math.abs(g.polygonArea(sq2) - 10000) < 30, g.polygonArea(sq2).toFixed(1));
const c = g.centroid(sq2, 'polygon'); const cxy = pr.toXY(c);
check('centroid', Math.abs(cxy.x - 50) < 0.5 && Math.abs(cxy.y - 50) < 0.5, JSON.stringify(cxy));
check('point in polygon', g.pointInPolygon(c, sq2) && !g.pointInPolygon(pr.toLatLng({ x: 150, y: 50 }), sq2));

// 4) 平均化: 誤差の小さい測位ほど効く
const av = g.averageFixes([{ lat: 0, lng: 0, acc: 2 }, { lat: 0.001, lng: 0, acc: 20 }]);
check('weighted average', av.lat < 0.00002 && av.acc === 2 && av.n === 2, JSON.stringify(av));
check('distance', Math.abs(g.distance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111319.5) < 1);

console.log(`geo: ${ok} passed, ${ng} failed`);
process.exit(ng ? 1 : 0);

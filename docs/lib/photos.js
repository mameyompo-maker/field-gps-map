/* field_gps_map — 写真の縮小(撮影・選択した写真を、保存・送信できる大きさにする)。
 *
 * 保存のしかた(store-*.js):写真は Firebase Storage ではなく、Firestore の
 *   gpsFeatures/{id}/photos/{photoId} に JPEG の data URL として入れる。
 *   理由:Firestore の書き込みは圏外でも端末に溜まり、電波が戻ると SDK が自動で送る。
 *   Storage へのアップロードは圏外で溜められず、field_visit_map では自前の送信待ち
 *   キュー(offline-queue.js)が要った。記録と写真が同じ仕組みで送られる方が単純で壊れにくい。
 * そのため1枚を Firestore の1文書の上限(1 MiB)より十分小さくする:
 *   本体 … 長辺 1280px・品質 0.72(だいたい 150〜300 KB)。大きすぎれば段階的に縮める。
 *   表紙 … 長辺 160px・品質 0.6(数 KB)。一覧の小さな写真用に記録そのものに入れる。
 * 縦横の向き(EXIF)は createImageBitmap の imageOrientation で正しく直す。
 */
export const MAX_PHOTOS = 10;
const MAX_DATA_CHARS = 900000;   // data URL の文字数の上限(1 MiB の文書に余裕を残す)

function toDataUrl(bitmap, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { data: canvas.toDataURL('image/jpeg', quality), w, h };
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 古いブラウザは options 付きを受け付けない
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

/** 写真ファイル → { data, thumb, w, h, takenAt }。読めなければ例外。 */
export async function preparePhoto(file) {
  const bmp = await decode(file);
  let out = null;
  for (const [dim, q] of [[1280, 0.72], [1280, 0.6], [1024, 0.6], [800, 0.55]]) {
    out = toDataUrl(bmp, dim, q);
    if (out.data.length <= MAX_DATA_CHARS) break;
  }
  const thumb = toDataUrl(bmp, 160, 0.6).data;
  if (bmp.close) bmp.close();
  if (!out || out.data.length > MAX_DATA_CHARS) throw new Error('too large');
  return { data: out.data, thumb, w: out.w, h: out.h, takenAt: file.lastModified || Date.now() };
}

/** data URL → File(共有・ZIP 用)。 */
export function dataUrlToFile(dataUrl, name) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: mime });
}

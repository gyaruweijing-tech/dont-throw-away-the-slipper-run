import * as THREE from 'three';

/**
 * 輪郭線（inverted hull）。
 *
 * ★**キャラには使わない。**
 * うちのキャラは**アルファテストで切り抜いた板**なので、ジオメトリを膨らませても
 * 膨らむのは「四角い板」であって「絵の輪郭」ではない。**四角い枠が出るだけ**になる。
 * キャラの輪郭線は**アトラスの絵に描き込んである**ので、それで足りている
 * （外部レビューの指摘で気づいた。当初は全部に掛ける計画だった）。
 *
 * 使うのは**立体（棚・障害物）だけ**。箱には正しく効く。
 *
 * ### 仕組み
 * 同じジオメトリを**法線方向に膨らませ**、**裏面だけ**を暗い色で描く。
 * 本体が手前に描かれるので、はみ出した縁だけが線として残る。
 *
 * ### InstancedMesh のとき
 * **`instanceMatrix` を共有する**ので、位置の同期処理が要らない（コストほぼゼロ）。
 * 本体側が行列を更新すれば、輪郭も一緒に動く。
 */

const COLOR = 0x3a2f27;   // 濃い茶。真っ黒より柔らかい（任天堂系の定石）

/** 法線方向に膨らませたジオメトリを作る */
function inflate(src: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (!nrm) return g;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nrm.getX(i) * width,
      pos.getY(i) + nrm.getY(i) * width,
      pos.getZ(i) + nrm.getZ(i) * width,
    );
  }
  pos.needsUpdate = true;
  return g;
}

/**
 * 輪郭線の双子を作って、同じ親に足す。
 *
 * @param width 線の太さ（ワールド単位）。**画面上のピクセル幅ではない**ので、
 *   遠くの物ほど線は細くなる。この作品はカメラ距離がほぼ一定なので問題にならないが、
 *   寄り引きが大きいゲームでは破綻する手法である点は覚えておく
 */
export function addOutline(mesh: THREE.Mesh | THREE.InstancedMesh, width = 0.045): void {
  const geo = inflate(mesh.geometry, width);
  const mat = new THREE.MeshBasicMaterial({
    color: COLOR,
    // **裏面だけ描く。** 表を描くと本体を覆ってしまう
    side: THREE.BackSide,
    fog: true,
  });

  let twin: THREE.Mesh | THREE.InstancedMesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const src = mesh as THREE.InstancedMesh;
    const inst = new THREE.InstancedMesh(geo, mat, src.count > 0 ? src.count : 1);
    // **行列を共有する。** 本体が動けば輪郭も動く。同期のコードが要らない
    inst.instanceMatrix = src.instanceMatrix;
    inst.count = src.count;
    inst.frustumCulled = false;
    // 本体より先に描く
    inst.renderOrder = (src.renderOrder ?? 0) - 1;
    twin = inst;
    // count は毎フレーム変わるので、描画の直前に合わせる
    inst.onBeforeRender = () => { inst.count = src.count; };
  } else {
    twin = new THREE.Mesh(geo, mat);
    twin.renderOrder = (mesh.renderOrder ?? 0) - 1;
  }

  twin.position.copy(mesh.position);
  twin.rotation.copy(mesh.rotation);
  twin.scale.copy(mesh.scale);
  (mesh.parent ?? mesh).add(twin);
}

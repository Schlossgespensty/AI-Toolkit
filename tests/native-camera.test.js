const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/js/iso-geometry');
const evidence = require('./fixtures/native-camera-projection.json');
const catalogue = require('../assets/aiv/iso/verzeichnis.json');
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

test('all four camera projections match coordinates read from the native game tables', () => {
  let checked=0;
  for (const sample of evidence.samples) for (const orientation of [0,2,4,6]) {
    const screen=sample.screen[orientation];
    // The game's focus table omits some outer border tiles.
    if (!screen) continue;
    const p=geo.rotateGrid(sample.x,sample.y,1,orientation,400);
    assert.deepEqual([(p.gx-p.gy+200)*16,(p.gx+p.gy-199)*8],screen,
      `native tile ${sample.tile}, orientation ${orientation}`);
    checked++;
  }
  assert.ok(checked>70);
});

test('four camera turns preserve focus, elevation, zoom and fractional pan', () => {
  for (const direction of [2,6]) for (const height of [0,37,255]) {
    const original={zoom:.73,panX:173.125,panY:-249.25};
    let view=original;
    for(let turn=0;turn<4;turn++) view=geo.turnCameraView(view,1377,831,direction,height);
    close(view.panX,original.panX);close(view.panY,original.panY);close(view.zoom,original.zoom);
  }
});

test('flat-preview affine transform agrees with per-tile projection outside the village', () => {
  const view={zoom:1.37,panX:531.25,panY:-184.5};
  for(const orientation of [0,2,4,6]) for(const [x,y] of [[-130,210],[0,0],[27,81],[100,100],[310,-20]]) {
    const [a,b,c,d,e,f]=geo.cameraCanvasTransform(view,orientation);
    const [px,py]=geo.isoPoint(x,y,view);
    // A corner uses edge-x; a one-tile anchor uses edge-1-x.
    const p=geo.rotateGrid(x,y,1,orientation,101);
    const expected=geo.isoPoint(p.gx,p.gy,view);
    close(a*px+c*py+e,expected[0]);close(b*px+d*py+f,expected[1]);
  }
});

test('terrain and picking use the inverse camera separately from AIV placement orientation', () => {
  const keep={x:181,y:250,orientation:6};
  const height=87,view={zoom:.9,panX:630,panY:-180};
  const local={gx:31,gy:62};
  const base=geo.rotateGrid(local.gx,local.gy,1,keep.orientation);
  const world=geo.mapTileForGrid(base.gx,base.gy,keep);
  for(const camera of [0,2,4,6]) {
    const displayed=geo.rotateGrid(base.gx,base.gy,1,camera);
    const ground=geo.unrotateGrid(displayed.gx,displayed.gy,camera);
    assert.deepEqual(geo.mapTileForGrid(ground.gx,ground.gy,keep),world);
    const [px,py]=geo.isoPoint(displayed.gx+.5,displayed.gy+.5,view,height);
    const picked=geo.tileFromPoint(px,py,view,()=>height);
    assert.deepEqual(geo.unrotateGrid(picked.gx,picked.gy,(keep.orientation+camera)%8),local);
  }
});

test('Keep ground plates rotate with their world anchors', () => {
  const entry=catalogue.gegenstaende[61], original={gx:43,gy:50,tiles:7,entry};
  const base=geo.collectPlates([original]);
  for(const camera of [0,2,4,6]) {
    const p=geo.rotateGrid(original.gx,original.gy,7,camera);
    const plates=geo.collectPlates([{...original,...p,cameraRotation:camera}]);
    plates.forEach((plate,i)=> {
      const expected=geo.rotateGrid(base[i].gx,base[i].gy,base[i].tiles,camera);
      assert.equal(plate.gx,expected.gx);assert.equal(plate.gy,expected.gy);
    });
  }
});

test('every farm camera keeps its native 3x3 hut together and rotates the entire field', () => {
  for(const type of [70,71,72,73]) {
    const entry=catalogue.gegenstaende[type];
    for(const camera of [0,2,4,6]) entry.cameraPartsLayouts[camera/2].forEach((parts,layout)=> {
      const origin=geo.rotateGrid(0,0,3,camera,entry.kacheln);
      assert.equal(Math.min(...parts.slice(0,9).map(p=>p.gx)),origin.gx);
      assert.equal(Math.min(...parts.slice(0,9).map(p=>p.gy)),origin.gy);
      assert.equal(parts.length,entry.partsLayouts[layout].length);
      parts.slice(9).forEach((part,i)=> {
        const initial=entry.partsLayouts[layout][i+9];
        const p=geo.rotateGrid(initial.gx,initial.gy,1,camera,entry.kacheln);
        assert.equal(part.gx,p.gx);assert.equal(part.gy,p.gy);
      });
    });
  }
});

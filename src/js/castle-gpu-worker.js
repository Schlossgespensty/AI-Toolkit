"use strict";
importScripts("../vendor/pixi/pixi.min.js");
const assets = new Map();
async function createStage(canvas) {
  const P = self.PIXI;
  P.DOMAdapter.set({
    createCanvas: (w = 1, h = 1) => new OffscreenCanvas(w, h),
    getWebGLRenderingContext: () => WebGLRenderingContext,
    getCanvasRenderingContext2D: () => OffscreenCanvasRenderingContext2D,
    getNavigator: () => navigator,
    getBaseUrl: () => location.href,
    fetch: (...args) => fetch(...args),
  });
  P.extensions.remove(P.DOMPipe, P.AccessibilitySystem, P.EventSystem);
  const renderer = new P.WebGLRenderer();
  await renderer.init({
    canvas,
    width: 1,
    height: 1,
    resolution: 1,
    antialias: false,
    backgroundAlpha: 0,
  });
  const stage = new P.Container({
    sortableChildren: true,
    eventMode: "none",
    interactiveChildren: false,
  });
  const sources = new Map(),
    textures = new Map(),
    buildings = new Map();
  let terrainCommands = null,
    terrainNodes = [],
    terrainLookup = new Map(),
    documentRevision;
  function node(command, existing = null) {
    if (!command.imageId) {
      existing?.destroy();
      return new P.Graphics()
        .poly(command.polygon.flat())
        .fill({ color: 0xd2aa5a, alpha: 0.55 });
    }
    const image = assets.get(command.imageId),
      args = command.args;
    const crop =
      args.length === 8 ? args.slice(0, 4) : [0, 0, image.width, image.height];
    const key = `${command.imageId}:${crop.join(",")}`;
    let texture = textures.get(key);
    if (!texture) {
      let source = sources.get(image);
      if (!source) {
        source = new P.ImageSource({ resource: image, scaleMode: "nearest" });
        sources.set(image, source);
      }
      texture = new P.Texture({ source, frame: new P.Rectangle(...crop) });
      textures.set(key, texture);
    }
    const sprite = existing instanceof P.Sprite ? existing : new P.Sprite(texture);
    if (existing && sprite !== existing) existing.destroy();
    sprite.texture = texture;
    [sprite.x, sprite.y, sprite.width, sprite.height] = args.slice(-4);
    return sprite;
  }
  function clearBuildings() {
    for (const sprite of buildings.values()) sprite.destroy();
    buildings.clear();
  }

  return {
    setScene(terrain, ordered, revision) {
      const terrainChanged = terrainCommands !== terrain;
      if (terrainChanged) {
        stage.removeChildren();
        clearBuildings();
        // A different start uses the same atlas. Reuse GPU textures and sprite
        // slots instead of uploading the complete atlas again on every switch.
        const previous = terrainNodes;
        terrainCommands = terrain;
        terrainNodes = terrain.map((command, i) => node(command, previous[i]));
        for (let i = terrain.length; i < previous.length; i++) previous[i].destroy();
        terrainLookup = new Map(
          terrain.map((command, i) => [command, terrainNodes[i]]),
        );
        for (const sprite of terrainNodes) if (sprite.parent !== stage) stage.addChild(sprite);
      }
      if (documentRevision !== revision) {
        clearBuildings();
        documentRevision = revision;
      }
      for (const sprite of buildings.values()) sprite.visible = false;
      const occurrences = new Map();
      const usedImages = terrainChanged ? new Set(terrain.map(command => assets.get(command.imageId))) : null;
      let index = 0;
      for (const command of ordered) {
        usedImages?.add(assets.get(command.imageId));
        let sprite = terrainLookup.get(command);
        if (!sprite) {
          const occurrence = occurrences.get(command.key) || 0;
          occurrences.set(command.key, occurrence + 1);
          const key = `${command.key}#${occurrence}`;
          sprite = buildings.get(key);
          if (!sprite) {
            sprite = node(command);
            buildings.set(key, sprite);
            stage.addChild(sprite);
          }
          sprite.visible = true;
        }
        sprite.zIndex = index++;
      }
      if (usedImages) {
        const retired = new Set([...sources].filter(([image]) => !usedImages.has(image)).map(([, source]) => source));
        for (const [key, texture] of textures) if (retired.has(texture.source)) {
          texture.destroy(); textures.delete(key);
        }
        for (const [image, source] of sources) if (retired.has(source)) {
          source.destroy(); sources.delete(image);
        }
      }
    },

    async renderMask(ordered, width, height) {
      const maskStage = new P.Container({eventMode:"none",interactiveChildren:false});
      const texture = P.RenderTexture.create({width, height, resolution:1});
      try {
        for (const command of ordered) {
          const sprite = node(command);
          sprite.blendMode = command.flammable ? "normal" : "erase";
          maskStage.addChild(sprite);
        }
        renderer.render({container:maskStage,target:texture,clear:true});
        return await createImageBitmap(renderer.extract.canvas({target:texture}));
      } finally {
        maskStage.destroy({children:true});
        texture.destroy(true);
      }
    },
    render(width, height, zoom, x, y) {
      if (renderer.gl.isContextLost()) throw new Error("GPU context lost");
      if (renderer.width !== width || renderer.height !== height)
        renderer.resize(width, height);
      stage.scale.set(zoom);
      stage.position.set(x, y);
      renderer.render({ container: stage });
    },
  };
}
let ready;
let terrain = [];
let maskVersion = null;
const commands = new Map();
function order(a, b) {
  return (
    a.order[0] - b.order[0] ||
    a.order[1] - b.order[1] ||
    a.order[2] - b.order[2]
  );
}
function* merge(a, b) {
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length)
    yield order(a[i], b[j]) <= 0 ? a[i++] : b[j++];
  while (i < a.length) yield a[i++];
  while (j < b.length) yield b[j++];
}
onmessage = async ({ data }) => {
  try {
    if (data.init) {
      ready = createStage(data.canvas);
      await ready;
      postMessage({ ready: true });
      return;
    }
    const stage = await ready;
    for (const [id, bitmap] of data.assets) assets.set(id, bitmap);
    if (data.terrain) terrain = data.terrain;
    if (data.reset) commands.clear();
    for (const [id, command] of data.records) commands.set(id, command);
    const buildings = Array.from(data.visible, (id) => commands.get(id));
    stage.setScene(terrain, merge(terrain, buildings), data.revision);
    stage.render(...data.view);
    let mask = null;
    if (data.mask && maskVersion !== data.sceneVersion) {
      mask = await stage.renderMask(merge(terrain, buildings), ...data.mask);
      maskVersion = data.sceneVersion;
    }
    const released = [];
    if (data.terrain) {
      const used = new Set([...terrain, ...buildings].map(command => command.imageId));
      for (const [id, bitmap] of assets) if (!used.has(id)) {
        bitmap.close(); assets.delete(id); released.push(id);
      }
    }
    postMessage({ id: data.id, released, mask, sceneVersion:data.sceneVersion }, mask ? [mask] : []);
  } catch (error) {
    postMessage({ error: String(error.stack || error) });
  }
};

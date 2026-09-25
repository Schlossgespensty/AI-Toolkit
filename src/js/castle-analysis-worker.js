'use strict';
importScripts('castle-game-data.js', 'castle-geometry.js', 'castle-analysis.js');
self.onmessage = ({ data }) => {
  try {
    const { id, placements, terrain, fire, paths } = data;
    const routes=paths ? castleAnalysis.routes(placements,100,terrain) : [];
    self.postMessage({ id,
      heat: fire ? castleAnalysis.fireExposure(placements) : null,
      routes, walkability:routes.walkability });
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};

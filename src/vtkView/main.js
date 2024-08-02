import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import "@kitware/vtk.js/Rendering/Profiles/Geometry";

export default class VtkView {
  constructor(domElement, actor) {
    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
      rootContainer: domElement,
    });
    this.renderer = fullScreenRenderer.getRenderer();
    this.renderWindow = fullScreenRenderer.getRenderWindow();
    this.renderer.addActor(actor);
    this.animate();
  }
  animate() {
    this.renderer.resetCamera();
    this.renderWindow.render();
  }
}

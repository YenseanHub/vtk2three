import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow.js";
import type { IFullScreenRenderWindowInitialValues } from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow.js";
import type { vtkFullScreenRenderWindow as VtkFullScreenRenderWindowType } from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow.js";
import type { vtkActor } from "@kitware/vtk.js/Rendering/Core/Actor.js";
import type { vtkRenderer } from "@kitware/vtk.js/Rendering/Core/Renderer.js";
import type { vtkRenderWindow } from "@kitware/vtk.js/Rendering/Core/RenderWindow.js";
import "@kitware/vtk.js/Rendering/Profiles/Geometry.js";

export default class VtkView {
  private readonly renderer: vtkRenderer;
  private readonly renderWindow: vtkRenderWindow;
  private readonly fullScreenRenderer: VtkFullScreenRenderWindowType;

  constructor(domElement: HTMLElement, actor: vtkActor) {
    // vtk.js 38 d.ts misses rootContainer, but the runtime still supports it
    const initialValues: IFullScreenRenderWindowInitialValues & {
      rootContainer: HTMLElement;
    } = { rootContainer: domElement };
    this.fullScreenRenderer =
      vtkFullScreenRenderWindow.newInstance(initialValues);

    this.renderer = this.fullScreenRenderer.getRenderer();
    this.renderWindow = this.fullScreenRenderer.getRenderWindow();
    this.renderer.addActor(actor);
    this.animate();
  }

  animate(): void {
    this.renderer.resetCamera();
    this.renderWindow.render();
  }

  dispose(): void {
    this.fullScreenRenderer.delete();
  }
}
